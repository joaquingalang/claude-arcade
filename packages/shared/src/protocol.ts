/**
 * The wire contract between the injected Claude Code hooks and the Claude Arcade app.
 *
 * We consume a deliberately small subset of the hook payload. Claude Code sends more
 * fields than these and may add more over time; unknown fields are ignored rather than
 * validated, so a Claude Code upgrade can't break the widget.
 */

export const APP_ID = 'claude-arcade';

/** Hook events we subscribe to. Anything else that arrives is ignored, not an error. */
export const SUBSCRIBED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolBatch',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'PostCompact',
  'Notification',
  'PermissionRequest',
  'Elicitation',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;

export type HookEvent = (typeof SUBSCRIBED_EVENTS)[number];

export interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  tool_name?: string;
  /**
   * True when a Stop hook itself caused the model to continue. The turn is NOT over;
   * treating this as completion makes the widget flicker off mid-work.
   */
  stop_hook_active?: boolean;
}

/**
 * `done` is transient - it exists so the UI layer can distinguish "finished normally"
 * from "never started". Sessions in `done` are pruned on the next event or by the
 * watchdog.
 */
export type SessionState = 'idle' | 'working' | 'needs-user' | 'done';

export interface SessionInfo {
  sessionId: string;
  state: SessionState;
  cwd?: string;
  /** epoch ms when this session entered `working`; null when not working. */
  workingSince: number | null;
  /** epoch ms of the last event of any kind. Drives the watchdog. */
  lastEventAt: number;
  /** pid of the `arcade` wrapper that launched this session, when known. */
  launcherPid?: number;
  /** Correlates this session back to the `arcade` invocation that started it. */
  launcherToken?: string;
}

/** Body of the CLI's POST /session-registered, sent before Claude starts. */
export interface SessionRegistration {
  launcherPid: number;
  cwd: string;
  /** Correlates the registration with hook events, which carry session_id. */
  token: string;
}

/**
 * Body of the CLI's POST /play - put a named widget on screen right now.
 *
 * The one request that isn't about a Claude session at all: it says nothing about what
 * Claude is doing, it just asks for a toy. See `handPicked` in the app's main process for
 * what that outranks.
 */
export interface PlayRequest {
  widgetId: string;
}

export interface PingResponse {
  app: typeof APP_ID;
  version: string;
  port: number;
}

export interface RuntimeFile {
  app: typeof APP_ID;
  port: number;
  /**
   * PID of the process that wrote this file. A liveness hint inside an existing trust
   * boundary, NOT authentication - the actual boundary is that we only ever bind to
   * loopback. Used so a stale file doesn't send the CLI to a dead port, and so a
   * shutting-down instance can't delete a newer instance's file.
   */
  ownerPid: number;
}
