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
