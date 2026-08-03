import { LOOPBACK, SUBSCRIBED_EVENTS } from '@claude-arcade/shared';

/**
 * Build the settings object injected via `claude --settings <json>`.
 *
 * Two properties make this safe to hand to Claude Code:
 *
 * - `--settings` loads ADDITIONAL settings and hooks merge across scopes, so this
 *   applies only to the session we launch. `~/.claude/settings.json` is never read or
 *   written, which is why we can coexist with other hook-based companion apps without
 *   any merge/backup/uninstall logic.
 * - `async: true` means Claude never blocks on us. If the app hangs or dies, the hook
 *   is fire-and-forget and the user's session is unaffected.
 */
export interface HookSettings {
  hooks: Record<string, Array<{ hooks: Array<HttpHookHandler> }>>;
}

interface HttpHookHandler {
  type: 'http';
  url: string;
  timeout: number;
  async: true;
}

export function buildHookSettings(port: number, token: string): HookSettings {
  const url = `http://${LOOPBACK}:${port}/hook?token=${encodeURIComponent(token)}`;
  const handler: HttpHookHandler = { type: 'http', url, timeout: 5, async: true };

  const hooks: HookSettings['hooks'] = {};
  for (const event of SUBSCRIBED_EVENTS) {
    hooks[event] = [{ hooks: [handler] }];
  }
  return { hooks };
}

/**
 * Serialised for a single argv element. Spawned with `shell: false`, so there is no
 * quoting or escaping hazard; the payload is ~2KB, far under the 32767-char Windows
 * command line limit.
 */
export function serializeHookSettings(settings: HookSettings): string {
  return JSON.stringify(settings);
}
