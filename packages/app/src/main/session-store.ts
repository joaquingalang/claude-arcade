import {
  type HookPayload,
  type SessionInfo,
  type SessionState,
  isPidAlive,
} from '@claude-arcade/shared';

/** No event for this long, with a dead launcher, means the session is gone. */
export const WATCHDOG_TIMEOUT_MS = 120_000;

export interface SessionStoreOptions {
  /** How long a turn must run before the widget appears. Prevents flicker on fast turns. */
  showDelayMs?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

/**
 * Tracks every Claude session launched through `arcade` and derives one question:
 * should the widget be visible right now?
 *
 * Keyed by session_id. Multiple concurrent sessions are normal - the widget stays up
 * while ANY of them is working.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionInfo>();
  private readonly showDelayMs: number;
  private readonly now: () => number;
  private readonly isAlive: (pid: number) => boolean;
  /** Registrations arrive from the CLI before the session_id exists; queued here. */
  private pendingLaunchers: Array<{ pid: number; cwd: string; token: string }> = [];
  /** Prompts seen across all sessions. See promptCount(). */
  private prompts = 0;

  constructor(options: SessionStoreOptions = {}) {
    this.showDelayMs = options.showDelayMs ?? 2500;
    this.now = options.now ?? Date.now;
    this.isAlive = options.isAlive ?? isPidAlive;
  }

  registerLauncher(pid: number, cwd: string, token: string): void {
    this.pendingLaunchers.push({ pid, cwd, token });
  }

  unregisterLauncher(token: string): void {
    this.pendingLaunchers = this.pendingLaunchers.filter((l) => l.token !== token);
    for (const [id, session] of this.sessions) {
      if (session.launcherToken === token) this.sessions.delete(id);
    }
  }

  /** Apply a hook event. Unknown events are ignored so Claude upgrades can't break us. */
  apply(payload: HookPayload, token?: string): void {
    const sessionId = payload.session_id;
    const event = payload.hook_event_name;
    if (!sessionId || !event) return;

    const t = this.now();
    const session = this.sessions.get(sessionId) ?? this.createSession(sessionId, payload, token);
    session.lastEventAt = t;
    if (payload.cwd) session.cwd = payload.cwd;

    /**
     * Whether a turn is under way right now.
     *
     * Only a prompt starts one. Every other event may pause, resume or end a turn
     * already running, and none of them may begin one - which is what keeps a finished
     * turn finished. The hooks are async and fire-and-forget, so the tail of a turn
     * (a PostToolUse, a Notification, a subagent's Stop) routinely lands after the Stop
     * that ended it; treating one of those as work is what made the widget reappear
     * seconds after Claude went quiet.
     */
    const inTurn = session.state === 'working' || session.state === 'needs-user';

    switch (event) {
      case 'UserPromptSubmit':
        // Counted, not just applied: a dismissed widget is allowed back at the next
        // prompt and nowhere else, and this is how the app dates that dismissal.
        this.prompts++;
        this.enterWorking(session, t);
        break;

      // Tool activity and subagents are proof of life, not state changes. They lift the
      // pause a Notification put the turn in; on a turn already working they only push
      // the watchdog out, since enterWorking keeps the original start time.
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PostToolBatch':
      case 'SubagentStart':
      case 'SubagentStop':
      // Auto-compaction happens mid-turn and work resumes right after. Treating this
      // as completion would hide the widget precisely during a long turn.
      case 'PostCompact':
        if (inTurn) this.enterWorking(session, t);
        break;

      // Claude is asking the user something. A toy covering the prompt is actively
      // harmful, so this hides immediately rather than waiting for the turn to end.
      case 'Notification':
      case 'PermissionRequest':
      case 'Elicitation':
        if (!inTurn) break;
        session.state = 'needs-user';
        session.workingSince = null;
        break;

      case 'Stop':
      case 'StopFailure':
        if (!inTurn) break;
        // A Stop hook that itself resumed the model: the turn is not over. It keeps a
        // running turn running; it cannot reopen one that has already ended, because
        // this flag arrives on the Stop that *closes* the resumed stretch - honouring
        // it there would put the widget up just as Claude stopped for good.
        if (payload.stop_hook_active) this.enterWorking(session, t);
        else this.endTurn(session);
        break;

      case 'PostToolUseFailure':
        if (inTurn) this.endTurn(session);
        break;

      case 'SessionEnd':
        this.sessions.delete(sessionId);
        return;

      case 'SessionStart':
        session.state = 'idle';
        session.workingSince = null;
        break;

      default:
        break;
    }

    this.sessions.set(sessionId, session);
  }

  private createSession(sessionId: string, payload: HookPayload, token?: string): SessionInfo {
    // Read, not consumed: one launcher can produce several session ids - a /clear starts a
    // new one in the same terminal - and each of them needs the pid for the watchdog to
    // check later. reap() retires the registration when the pid itself goes away.
    const idx = token ? this.pendingLaunchers.findIndex((l) => l.token === token) : -1;
    const launcher = idx >= 0 ? this.pendingLaunchers[idx] : undefined;

    return {
      sessionId,
      state: 'idle',
      cwd: payload.cwd ?? launcher?.cwd,
      workingSince: null,
      lastEventAt: this.now(),
      launcherPid: launcher?.pid,
      launcherToken: launcher?.token ?? token,
    };
  }

  /** The turn is over. Nothing but a new prompt may start another one. */
  private endTurn(session: SessionInfo): void {
    session.state = 'done';
    session.workingSince = null;
  }

  private enterWorking(session: SessionInfo, t: number): void {
    // Preserve the original start time across tool events so the show delay measures
    // the whole turn, not the time since the most recent tool call.
    if (session.state !== 'working' || session.workingSince === null) {
      session.workingSince = t;
    }
    session.state = 'working';
  }

  /**
   * Drop sessions that went quiet and whose launching terminal is gone.
   *
   * Covers the case where a terminal is killed outright: no Stop ever arrives, so
   * without this the widget would stay on screen forever.
   */
  reap(): void {
    const t = this.now();

    // A registration is otherwise removed only by /session-ended - which is precisely the
    // POST that never arrives when a terminal is killed, the case this watchdog exists
    // for. The app outlives every session it serves, so without this the list would grow
    // by one for every terminal anyone ever closed the hard way.
    this.pendingLaunchers = this.pendingLaunchers.filter((l) => this.isAlive(l.pid));

    for (const [id, session] of this.sessions) {
      if (session.state === 'done') {
        this.sessions.delete(id);
        continue;
      }
      const stale = t - session.lastEventAt > WATCHDOG_TIMEOUT_MS;
      if (!stale) continue;
      const launcherGone = session.launcherPid === undefined || !this.isAlive(session.launcherPid);
      if (launcherGone) this.sessions.delete(id);
    }
  }

  /** Visible iff some session has been working longer than the show delay. */
  shouldShowWidget(): boolean {
    const t = this.now();
    for (const session of this.sessions.values()) {
      if (session.state !== 'working' || session.workingSince === null) continue;
      if (t - session.workingSince >= this.showDelayMs) return true;
    }
    return false;
  }

  /** ms until the widget should next become visible, or null if nothing is pending. */
  msUntilNextShow(): number | null {
    const t = this.now();
    let soonest: number | null = null;
    for (const session of this.sessions.values()) {
      if (session.state !== 'working' || session.workingSince === null) continue;
      const remaining = this.showDelayMs - (t - session.workingSince);
      if (remaining <= 0) return 0;
      if (soonest === null || remaining < soonest) soonest = remaining;
    }
    return soonest;
  }

  stateOf(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)?.state;
  }

  /**
   * How many prompts have been submitted, across every session, since the app started.
   *
   * A monotonic stamp for "this stretch of work", which is the unit a dismissal covers:
   * the app records the count when the user closes the widget and shows it again only
   * once the count has moved on. Deliberately not per session - the widget is shared, so
   * closing it is a statement about the desktop, and any session prompting again is a
   * new stretch of work.
   */
  promptCount(): number {
    return this.prompts;
  }

  size(): number {
    return this.sessions.size;
  }

  /** Launcher registrations still waiting to be matched to a session. Reaped by pid. */
  pendingLauncherCount(): number {
    return this.pendingLaunchers.length;
  }

  all(): SessionInfo[] {
    return [...this.sessions.values()];
  }
}
