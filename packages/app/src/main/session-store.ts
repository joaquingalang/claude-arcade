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

    switch (event) {
      case 'UserPromptSubmit':
        this.enterWorking(session, t);
        break;

      // Tool activity and subagents are proof of life, not state changes.
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PostToolBatch':
      case 'SubagentStart':
      case 'SubagentStop':
        if (session.state !== 'working') this.enterWorking(session, t);
        break;

      // Auto-compaction happens mid-turn and work resumes right after. Treating this
      // as completion would hide the widget precisely during a long turn.
      case 'PostCompact':
        if (session.state !== 'working') this.enterWorking(session, t);
        break;

      // Claude is asking the user something. A toy covering the prompt is actively
      // harmful, so this hides immediately rather than waiting for the turn to end.
      case 'Notification':
      case 'PermissionRequest':
      case 'Elicitation':
        session.state = 'needs-user';
        session.workingSince = null;
        break;

      case 'Stop':
      case 'StopFailure':
        // A Stop hook that itself resumed the model: the turn is not over.
        if (payload.stop_hook_active) {
          this.enterWorking(session, t);
        } else {
          session.state = 'done';
          session.workingSince = null;
        }
        break;

      case 'PostToolUseFailure':
        session.state = 'done';
        session.workingSince = null;
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
    // Claim the queued launcher registration matching this token, so the watchdog can
    // later check whether the terminal that started this session still exists.
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

  size(): number {
    return this.sessions.size;
  }

  all(): SessionInfo[] {
    return [...this.sessions.values()];
  }
}
