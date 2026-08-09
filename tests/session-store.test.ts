import { describe, expect, it } from 'vitest';

import {
  SessionStore,
  WATCHDOG_TIMEOUT_MS,
} from '../packages/app/src/main/session-store';
import type { HookPayload, SessionState } from '../packages/shared/src/protocol';

/** Controllable clock so delay behaviour is tested deterministically, not with sleeps. */
function makeStore(opts: { showDelayMs?: number; alive?: boolean } = {}) {
  let clock = 1_000_000;
  const store = new SessionStore({
    showDelayMs: opts.showDelayMs ?? 2500,
    now: () => clock,
    isAlive: () => opts.alive ?? true,
  });
  return {
    store,
    advance: (ms: number) => {
      clock += ms;
    },
    at: () => clock,
  };
}

const ev = (name: string, extra: Partial<HookPayload> = {}): HookPayload => ({
  session_id: 's1',
  hook_event_name: name,
  ...extra,
});

describe('SessionStore state transitions', () => {
  const cases: Array<{ event: string; from: string[]; expect: SessionState }> = [
    { event: 'UserPromptSubmit', from: [], expect: 'working' },
    { event: 'PreToolUse', from: ['UserPromptSubmit'], expect: 'working' },
    { event: 'PostToolUse', from: ['UserPromptSubmit'], expect: 'working' },
    { event: 'PostToolBatch', from: ['UserPromptSubmit'], expect: 'working' },
    { event: 'SubagentStart', from: ['UserPromptSubmit'], expect: 'working' },
    { event: 'SubagentStop', from: ['UserPromptSubmit'], expect: 'working' },
    { event: 'Notification', from: ['UserPromptSubmit'], expect: 'needs-user' },
    { event: 'PermissionRequest', from: ['UserPromptSubmit'], expect: 'needs-user' },
    { event: 'Elicitation', from: ['UserPromptSubmit'], expect: 'needs-user' },
    { event: 'Stop', from: ['UserPromptSubmit'], expect: 'done' },
    { event: 'StopFailure', from: ['UserPromptSubmit'], expect: 'done' },
    { event: 'PostToolUseFailure', from: ['UserPromptSubmit'], expect: 'done' },
  ];

  for (const c of cases) {
    it(`${c.from.join(' -> ') || '(new)'} + ${c.event} => ${c.expect}`, () => {
      const { store } = makeStore();
      for (const e of c.from) store.apply(ev(e));
      store.apply(ev(c.event));
      expect(store.stateOf('s1')).toBe(c.expect);
    });
  }

  it('PostCompact is not completion - auto-compact happens mid-turn', () => {
    const { store } = makeStore();
    store.apply(ev('UserPromptSubmit'));
    store.apply(ev('PostCompact'));
    expect(store.stateOf('s1')).toBe('working');
  });

  it('Stop with stop_hook_active is a re-entry, not the end of the turn', () => {
    const { store } = makeStore();
    store.apply(ev('UserPromptSubmit'));
    store.apply(ev('Stop', { stop_hook_active: true }));
    expect(store.stateOf('s1')).toBe('working');
  });

  it('SessionEnd removes the session entirely', () => {
    const { store } = makeStore();
    store.apply(ev('UserPromptSubmit'));
    store.apply(ev('SessionEnd'));
    expect(store.stateOf('s1')).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('ignores unknown events instead of throwing', () => {
    const { store } = makeStore();
    store.apply(ev('UserPromptSubmit'));
    expect(() => store.apply(ev('SomeFutureEventName'))).not.toThrow();
    expect(store.stateOf('s1')).toBe('working');
  });

  it('ignores payloads with no session id', () => {
    const { store } = makeStore();
    store.apply({ hook_event_name: 'UserPromptSubmit' });
    expect(store.size()).toBe(0);
  });
});

describe('show delay', () => {
  it('stays hidden before the delay elapses (the anti-flicker guarantee)', () => {
    const { store, advance } = makeStore({ showDelayMs: 2500 });
    store.apply(ev('UserPromptSubmit'));
    advance(2499);
    expect(store.shouldShowWidget()).toBe(false);
  });

  it('shows once the delay elapses', () => {
    const { store, advance } = makeStore({ showDelayMs: 2500 });
    store.apply(ev('UserPromptSubmit'));
    advance(2500);
    expect(store.shouldShowWidget()).toBe(true);
  });

  it('a fast turn never shows the widget', () => {
    const { store, advance } = makeStore({ showDelayMs: 2500 });
    store.apply(ev('UserPromptSubmit'));
    advance(400);
    store.apply(ev('Stop'));
    advance(5000);
    expect(store.shouldShowWidget()).toBe(false);
  });

  it('measures the whole turn, not the time since the last tool call', () => {
    const { store, advance } = makeStore({ showDelayMs: 2500 });
    store.apply(ev('UserPromptSubmit'));
    advance(2000);
    store.apply(ev('PreToolUse'));
    advance(600);
    // 2600ms into the turn, but only 600ms since PreToolUse.
    expect(store.shouldShowWidget()).toBe(true);
  });

  it('reports how long until the next show', () => {
    const { store, advance } = makeStore({ showDelayMs: 2500 });
    expect(store.msUntilNextShow()).toBeNull();
    store.apply(ev('UserPromptSubmit'));
    advance(1000);
    expect(store.msUntilNextShow()).toBe(1500);
  });

  it('hides immediately when Claude asks the user something', () => {
    const { store, advance } = makeStore({ showDelayMs: 2500 });
    store.apply(ev('UserPromptSubmit'));
    advance(3000);
    expect(store.shouldShowWidget()).toBe(true);
    store.apply(ev('PermissionRequest'));
    expect(store.shouldShowWidget()).toBe(false);
  });
});

describe('multiple concurrent sessions', () => {
  it('one session finishing does not hide a widget another still needs', () => {
    const { store, advance } = makeStore({ showDelayMs: 2500 });
    store.apply({ session_id: 'a', hook_event_name: 'UserPromptSubmit' });
    store.apply({ session_id: 'b', hook_event_name: 'UserPromptSubmit' });
    advance(3000);
    expect(store.shouldShowWidget()).toBe(true);

    store.apply({ session_id: 'a', hook_event_name: 'Stop' });
    expect(store.shouldShowWidget()).toBe(true);

    store.apply({ session_id: 'b', hook_event_name: 'Stop' });
    expect(store.shouldShowWidget()).toBe(false);
  });
});

describe('watchdog', () => {
  it('drops a stale session whose launching terminal is gone', () => {
    const { store, advance } = makeStore({ alive: false });
    store.registerLauncher(4242, 'C:/work', 'tok');
    store.apply(ev('UserPromptSubmit'), 'tok');
    advance(WATCHDOG_TIMEOUT_MS + 1);
    store.reap();
    expect(store.size()).toBe(0);
    expect(store.shouldShowWidget()).toBe(false);
  });

  it('keeps a stale session whose terminal is still alive', () => {
    const { store, advance } = makeStore({ alive: true });
    store.registerLauncher(4242, 'C:/work', 'tok');
    store.apply(ev('UserPromptSubmit'), 'tok');
    advance(WATCHDOG_TIMEOUT_MS + 1);
    store.reap();
    expect(store.size()).toBe(1);
  });

  it('does not reap an active session', () => {
    const { store, advance } = makeStore({ alive: false });
    store.registerLauncher(4242, 'C:/work', 'tok');
    store.apply(ev('UserPromptSubmit'), 'tok');
    advance(1000);
    store.reap();
    expect(store.size()).toBe(1);
  });

  it('prunes finished sessions so the map cannot grow without bound', () => {
    const { store } = makeStore();
    store.apply(ev('UserPromptSubmit'));
    store.apply(ev('Stop'));
    store.reap();
    expect(store.size()).toBe(0);
  });

  // The registration outlives the session on purpose, so /session-ended is the only thing
  // that removes it - and that is exactly the POST a killed terminal never sends. The app
  // runs for days, so this is the leak that case would otherwise leave behind.
  it('retires a launcher registration once its terminal is gone', () => {
    const { store } = makeStore({ alive: false });
    store.registerLauncher(4242, 'C:/work', 'tok');
    expect(store.pendingLauncherCount()).toBe(1);
    store.reap();
    expect(store.pendingLauncherCount()).toBe(0);
  });

  it('keeps the registration of a terminal that is still alive', () => {
    const { store } = makeStore({ alive: true });
    store.registerLauncher(4242, 'C:/work', 'tok');
    store.apply(ev('UserPromptSubmit'), 'tok');
    store.reap();
    expect(store.pendingLauncherCount()).toBe(1);
  });

  // Why it is kept rather than consumed on first use: a /clear starts a fresh session id
  // in the same terminal, and that session needs the pid too or it can never be reaped.
  it('still matches a second session from the same terminal', () => {
    const { store } = makeStore({ alive: true });
    store.registerLauncher(4242, 'C:/work', 'tok');
    store.apply(ev('UserPromptSubmit'), 'tok');
    store.apply(ev('UserPromptSubmit', { session_id: 's2' }), 'tok');
    expect(store.all().map((s) => s.launcherPid)).toEqual([4242, 4242]);
  });
});

describe('launcher lifecycle', () => {
  it('unregistering a launcher removes its sessions', () => {
    const { store, advance } = makeStore();
    store.registerLauncher(999, 'C:/work', 'tok');
    store.apply(ev('UserPromptSubmit'), 'tok');
    advance(3000);
    expect(store.shouldShowWidget()).toBe(true);

    store.unregisterLauncher('tok');
    expect(store.shouldShowWidget()).toBe(false);
    expect(store.size()).toBe(0);
  });
});
