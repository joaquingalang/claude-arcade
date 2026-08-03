#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { readRuntimeFile } from '@claude-arcade/shared';

import { buildHookSettings, serializeHookSettings } from './hook-settings';
import { ensureApp, fetchStatus, pingApp, resolveAppLaunch } from './ensure-app';
import { postJson } from './notify';
import { resolveClaude } from './resolve-claude';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function warn(message: string): void {
  // stderr, dimmed, one line. The widget is a toy; its problems must not shout.
  process.stderr.write(`${DIM}[arcade] ${message}${RESET}\n`);
}

/** Newest mtime anywhere under a directory tree, or 0 if it can't be read. */
function newestMtime(dir: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let newest = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else {
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        /* a file that vanished mid-walk is not a staleness signal */
      }
    }
  }
  return newest;
}

/**
 * Is the built `dist/` newer than every source file?
 *
 * Only ever called from `doctor`. Once `arcade` is on PATH it runs `dist/index.js`
 * directly, so an edit with no rebuild silently runs old code - but this check must never
 * move onto the launch path, where a recursive stat sweep would tax every Claude session.
 */
function checkBuildFreshness(repoRoot: string): string {
  let builtAt: number;
  try {
    builtAt = fs.statSync(path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js')).mtimeMs;
  } catch {
    return 'unknown';
  }

  // The emitted file alone can't date the build: `tsc -b` skips rewriting an output whose
  // contents didn't change, so an edit that compiles to identical JS leaves dist/index.js
  // older than its own source forever - a `stale` that no rebuild can clear. The
  // .tsbuildinfo files are stamped on every successful build, so they are the real date.
  for (const pkg of ['shared', 'cli', 'app']) {
    try {
      builtAt = Math.max(
        builtAt,
        fs.statSync(path.join(repoRoot, 'packages', pkg, 'tsconfig.tsbuildinfo')).mtimeMs,
      );
    } catch {
      /* a package that was never built shows up as newer source instead */
    }
  }

  let newestSrc = 0;
  for (const pkg of ['shared', 'cli', 'app']) {
    newestSrc = Math.max(newestSrc, newestMtime(path.join(repoRoot, 'packages', pkg, 'src')));
  }
  if (newestSrc === 0) return 'unknown';

  return newestSrc > builtAt ? 'stale - run npm run build' : 'up to date';
}

async function doctor(): Promise<number> {
  const claudePath = resolveClaude();
  const rt = readRuntimeFile();
  const reachable = rt ? await pingApp(rt.port) : false;

  // dist/index.js -> packages/cli -> packages -> repo root
  const cliRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const launch = resolveAppLaunch();

  process.stdout.write('Claude Arcade doctor\n');
  process.stdout.write(`  claude executable : ${claudePath ?? 'NOT FOUND on PATH'}\n`);
  // Once linked, `arcade` runs from wherever it was last linked - not from your cwd.
  process.stdout.write(`  install path      : ${cliRoot}\n`);
  process.stdout.write(
    `  app package       : ${launch ? (launch.args[0] ?? launch.command) : 'NOT FOUND - set ARCADE_APP_PATH'}\n`,
  );
  process.stdout.write(`  build             : ${checkBuildFreshness(repoRoot)}\n`);
  process.stdout.write(`  runtime.json      : ${rt ? 'present' : 'absent'}\n`);
  if (rt) {
    process.stdout.write(`  app port          : ${rt.port}\n`);
    process.stdout.write(`  app pid           : ${rt.ownerPid}\n`);
    process.stdout.write(`  /ping             : ${reachable ? 'ok' : 'no response'}\n`);

    const status = reachable ? await fetchStatus(rt.port) : null;
    if (status) {
      process.stdout.write(`  widget visible    : ${status.widgetVisible ? 'yes' : 'no'}\n`);
      process.stdout.write(`  active sessions   : ${status.sessions.length}\n`);
      for (const s of status.sessions) {
        process.stdout.write(`    - ${s.sessionId.slice(0, 8)} ${s.state}\n`);
      }
    }
  }

  const healthy = Boolean(claudePath) && Boolean(rt) && reachable;
  process.stdout.write(`  status            : ${healthy ? 'ready' : 'degraded'}\n`);
  if (!claudePath) {
    process.stdout.write('\n  claude was not found. Install Claude Code or set ARCADE_CLAUDE_PATH.\n');
  } else if (!healthy) {
    process.stdout.write('\n  The app is not running. It starts automatically on the next `arcade` run.\n');
  }
  return healthy ? 0 : 1;
}

/**
 * Run Claude, optionally wrapped.
 *
 * `stdio: 'inherit'` hands the child our real console handle. Claude's TUI is then
 * pixel-identical to running it directly - resize, mouse, and colours all work - and we
 * never parse its output. Lifecycle comes from hooks instead.
 */
async function runClaude(userArgs: string[], withWidget: boolean): Promise<number> {
  const claudePath = resolveClaude();
  if (!claudePath) {
    process.stderr.write(
      'arcade: could not find `claude` on PATH. Install Claude Code, or set ARCADE_CLAUDE_PATH.\n',
    );
    return 127;
  }

  let args = userArgs;
  let port: number | null = null;
  const token = randomUUID();

  if (withWidget) {
    const rt = await ensureApp();
    if (rt) {
      port = rt.port;
      await postJson(rt.port, '/session-registered', {
        launcherPid: process.pid,
        cwd: process.cwd(),
        token,
      });
      const settings = serializeHookSettings(buildHookSettings(rt.port, token));
      args = ['--settings', settings, ...userArgs];
    } else {
      warn('widget app unavailable - continuing without it');
    }
  }

  const child = spawn(claudePath, args, {
    stdio: 'inherit',
    windowsHide: false,
    shell: false,
  });

  // Ctrl+C belongs to the child. Without this the wrapper dies first and Claude is
  // orphaned mid-turn with its terminal state half-restored.
  const ignoreSignal = () => {};
  process.on('SIGINT', ignoreSignal);
  process.on('SIGTERM', ignoreSignal);

  const exitCode = await new Promise<number>((resolve) => {
    child.on('error', (err) => {
      process.stderr.write(`arcade: failed to launch claude: ${err.message}\n`);
      resolve(127);
    });
    child.on('exit', (code, signal) => {
      // A signalled child has no exit code; report it the way a shell would.
      if (code === null) resolve(signal ? 128 : 1);
      else resolve(code);
    });
  });

  if (port !== null) {
    await postJson(port, '/session-ended', { launcherPid: process.pid, token });
  }
  return exitCode;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === 'doctor') {
    process.exit(await doctor());
  }

  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(
      [
        'arcade - run Claude Code with a procrastination widget',
        '',
        'Usage:',
        '  arcade [claude args...]     run claude, showing a widget while it works',
        '  arcade --no-widget [...]    run claude unwrapped',
        '  arcade doctor               check that everything is wired up',
        '',
        'All other arguments are passed through to claude untouched.',
        '',
      ].join('\n'),
    );
    process.exit(0);
  }

  const withWidget = argv[0] !== '--no-widget';
  const userArgs = withWidget ? argv : argv.slice(1);

  process.exit(await runClaude(userArgs, withWidget));
}

main().catch((err) => {
  process.stderr.write(`arcade: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
