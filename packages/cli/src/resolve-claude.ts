import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Find the real `claude` executable.
 *
 * We can't shell out to `where`/`which` because that would find our own `arcade` shim
 * in some install layouts, and because spawning with `shell: true` is what we're
 * avoiding. Walk PATH directly instead.
 */
export function resolveClaude(): string | null {
  const override = process.env.ARCADE_CLAUDE_PATH;
  if (override && fs.existsSync(override)) return override;

  const isWindows = process.platform === 'win32';
  const names = isWindows ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'];

  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  // Claude Code's default install location isn't always on PATH for non-login shells.
  if (process.env.HOME || process.env.USERPROFILE) {
    const home = process.env.HOME ?? process.env.USERPROFILE!;
    dirs.push(path.join(home, '.local', 'bin'));
  }

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

export interface ClaudeLaunch {
  command: string;
  args: string[];
}

/**
 * How to actually spawn the executable `resolveClaude` found.
 *
 * `claude.cmd` is what an npm-global install of Claude Code leaves on PATH, and since Node
 * 18.20.2 spawning a `.cmd` or `.bat` with `shell: false` throws EINVAL - synchronously,
 * before there is an `error` listener to catch it. Batch files therefore have to go through
 * the command interpreter.
 *
 * Naming cmd here rather than passing `shell: true` is not a style preference: `shell: true`
 * measurably corrupts this particular command line. It flattens the arguments into one
 * string, so cmd - which does not know a `\"` from a `"` - eats every quote in the
 * `--settings` JSON and splits a prompt like `fix A & B` at the ampersand. Passing cmd its
 * arguments as separate argv entries instead leaves Node's own quoting in place, and the
 * whole 2KB payload arrives at the child byte for byte.
 *
 * A real `claude.exe` skips all of this and is spawned direct.
 */
export function claudeLaunch(
  claudePath: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ClaudeLaunch {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(claudePath)) {
    return { command: claudePath, args: [...args] };
  }

  // /d skips any AutoRun script the user has configured, /s settles the outer-quote rule,
  // /c runs the one command and exits.
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', claudePath, ...args],
  };
}
