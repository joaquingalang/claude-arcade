#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { GAME_IDS, TOY_IDS, readRuntimeFile, type PlayRequest } from '@claude-arcade/shared';

import { parseCommand, resolveWidgetId } from './commands';
import { buildHookSettings, serializeHookSettings } from './hook-settings';
import { ensureApp, fetchStatus, pingApp, resolveAppLaunch } from './ensure-app';
import { postJson } from './notify';
import { claudeLaunch, resolveClaude } from './resolve-claude';

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

  // The renderer is built by vite, which writes no .tsbuildinfo at all. Without this a
  // widget edit would be dated against whenever main last compiled, and every rebuild
  // after it would still read as stale - the bundle is the only record that it happened.
  builtAt = Math.max(
    builtAt,
    newestMtime(path.join(repoRoot, 'packages', 'app', 'dist', 'renderer')),
  );

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
      // Only when something is being played by hand: on a normal run there is nothing to
      // say here, and a line reading `none` would just be noise in the common case.
      if (status.playing) {
        process.stdout.write(`  playing           : ${status.playing} (arcade play)\n`);
      }
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

/** The menu, printed by `arcade list` and by a `play` that couldn't pick a widget. */
function widgetMenu(): string {
  return [
    'Fidget toys - they stay up until you take them away:',
    ...TOY_IDS.map((id) => `  ${id}`),
    '',
    'Games - they run to their own ending, then start again:',
    ...GAME_IDS.map((id) => `  ${id}`),
    '',
  ].join('\n');
}

/**
 * Put one widget on screen and leave it there.
 *
 * The only command that shows a widget with no Claude session behind it at all, which is
 * why it starts the app if it has to: someone typing `arcade play snake` wants a snake,
 * not a report that the app isn't up.
 */
async function play(name: string | null): Promise<number> {
  if (name === null) {
    process.stderr.write('arcade play: name a widget - for example `arcade play snake`.\n\n');
    process.stdout.write(widgetMenu());
    return 2;
  }

  const match = resolveWidgetId(name);
  if (match.found === null) {
    if (match.candidates.length > 0) {
      process.stderr.write(
        `arcade play: "${name}" could be ${match.candidates.join(', ')}. Say which.\n`,
      );
    } else {
      process.stderr.write(`arcade play: no widget called "${name}".\n\n`);
      process.stdout.write(widgetMenu());
    }
    return 2;
  }

  const rt = await ensureApp();
  if (!rt) {
    process.stderr.write(
      'arcade play: the widget app could not be started. Run `arcade doctor` to see why.\n',
    );
    return 1;
  }

  const body: PlayRequest = { widgetId: match.found };
  await postJson(rt.port, '/play', body);

  // The POST is fire-and-forget by design, so confirm from /status rather than assuming.
  // A running app that doesn't know the widget is showing is almost always one built
  // before this command existed.
  const status = await fetchStatus(rt.port);
  if (status && status.playing !== match.found) {
    process.stderr.write(
      `arcade play: the app did not take ${match.found}. If it is an older build, run \`npm run build\`.\n`,
    );
    return 1;
  }

  process.stdout.write(
    `playing ${match.found} - dismiss it in the corner, or run \`arcade stop\`.\n`,
  );
  return 0;
}

/**
 * Take a played widget back off screen.
 *
 * Deliberately does not start the app the way `play` does. Launching a desktop app in
 * order to tell it to show nothing is not a thing anyone wanted.
 */
async function stopPlaying(): Promise<number> {
  const rt = readRuntimeFile();
  if (!rt || !(await pingApp(rt.port))) {
    process.stdout.write('nothing playing - the widget app is not running.\n');
    return 0;
  }

  await postJson(rt.port, '/stop-playing', {});
  // Whatever Claude is doing takes the window back from here, which may mean it stays up
  // with a different widget in it.
  process.stdout.write('stopped.\n');
  return 0;
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

  const launch = claudeLaunch(claudePath, args);
  let child: ChildProcess | null = null;
  try {
    child = spawn(launch.command, launch.args, {
      stdio: 'inherit',
      windowsHide: false,
      shell: false,
    });
  } catch (err) {
    // spawn throws synchronously for a path the platform refuses outright, so the 'error'
    // listener below never sees it. Say so in one line rather than letting a stack trace
    // out of main() - a wrapper that cannot start Claude must still fail like a wrapper.
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`arcade: failed to launch claude (${claudePath}): ${detail}\n`);
  }

  let exitCode = 127;
  if (child) {
    // Ctrl+C belongs to the child. Without this the wrapper dies first and Claude is
    // orphaned mid-turn with its terminal state half-restored.
    const ignoreSignal = () => {};
    process.on('SIGINT', ignoreSignal);
    process.on('SIGTERM', ignoreSignal);

    const running = child;
    exitCode = await new Promise<number>((resolve) => {
      running.on('error', (err) => {
        process.stderr.write(`arcade: failed to launch claude: ${err.message}\n`);
        resolve(127);
      });
      running.on('exit', (code, signal) => {
        // A signalled child has no exit code; report it the way a shell would.
        if (code === null) resolve(signal ? 128 : 1);
        else resolve(code);
      });
    });
  }

  // Posted even when the spawn failed: the app is already holding a launcher registration
  // for a session that will now never produce a single hook event.
  if (port !== null) {
    await postJson(port, '/session-ended', { launcherPid: process.pid, token });
  }
  return exitCode;
}

function help(): number {
  process.stdout.write(
    [
      'arcade - run Claude Code with a procrastination widget',
      '',
      'Usage:',
      '  arcade [claude args...]     run claude, showing a widget while it works',
      '  arcade --no-widget [...]    run claude unwrapped',
      '  arcade play <widget>        put one widget on screen now and leave it there',
      '  arcade stop                 take a played widget back off screen',
      '  arcade list                 the widgets you can play',
      '  arcade doctor               check that everything is wired up',
      '',
      'All other arguments are passed through to claude untouched.',
      '',
    ].join('\n'),
  );
  return 0;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));

  // Every arm exits; process.exit() returns never, so there is nothing to fall through to.
  switch (command.kind) {
    case 'help':
      process.exit(help());
    case 'doctor':
      process.exit(await doctor());
    case 'list':
      process.stdout.write(widgetMenu());
      process.exit(0);
    case 'play':
      process.exit(await play(command.name));
    case 'stop':
      process.exit(await stopPlaying());
    case 'claude':
      process.exit(await runClaude(command.args, command.withWidget));
  }
}

main().catch((err) => {
  process.stderr.write(`arcade: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
