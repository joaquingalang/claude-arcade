import { describe, expect, it } from 'vitest';

import { parseCommand, resolveWidgetId } from '../packages/cli/src/commands';
import { claudeLaunch } from '../packages/cli/src/resolve-claude';
import { GAME_IDS, TOY_IDS, WIDGET_IDS } from '../packages/shared/src/widgets';
import { WIDGET_REGISTRY } from '../packages/app/src/renderer/widgets/registry';

describe('parseCommand', () => {
  it('claims its own subcommands', () => {
    expect(parseCommand(['doctor'])).toEqual({ kind: 'doctor' });
    expect(parseCommand(['list'])).toEqual({ kind: 'list' });
    expect(parseCommand(['stop'])).toEqual({ kind: 'stop' });
    expect(parseCommand(['play', 'snake'])).toEqual({ kind: 'play', name: 'snake' });
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' });
    expect(parseCommand(['-h'])).toEqual({ kind: 'help' });
  });

  it('treats `play` with nothing after it as a request for the menu, not an id', () => {
    expect(parseCommand(['play'])).toEqual({ kind: 'play', name: null });
  });

  // The whole contract of the wrapper: anything it doesn't recognise is a claude command
  // line. A subcommand that swallowed one of these would break real sessions.
  it('passes claude arguments through untouched', () => {
    for (const argv of [
      [],
      ['-p', 'fix the tests'],
      ['--model', 'opus'],
      ['-c'],
      ['--resume', 'play'],
    ]) {
      expect(parseCommand(argv)).toEqual({ kind: 'claude', args: argv, withWidget: true });
    }
  });

  it('only ever claims the first word', () => {
    // `play` here is claude's argument, not ours - it isn't in first position.
    expect(parseCommand(['-p', 'play snake'])).toEqual({
      kind: 'claude',
      args: ['-p', 'play snake'],
      withWidget: true,
    });
  });

  it('strips --no-widget and keeps the rest', () => {
    expect(parseCommand(['--no-widget', '-p', 'hi'])).toEqual({
      kind: 'claude',
      args: ['-p', 'hi'],
      withWidget: false,
    });
    expect(parseCommand(['--no-widget'])).toEqual({
      kind: 'claude',
      args: [],
      withWidget: false,
    });
  });

  // The escape hatch for the words we took: `claude doctor` is still reachable.
  it('leaves --no-widget doctor to claude', () => {
    expect(parseCommand(['--no-widget', 'doctor'])).toEqual({
      kind: 'claude',
      args: ['doctor'],
      withWidget: false,
    });
  });
});

describe('resolveWidgetId', () => {
  it('resolves every id to itself', () => {
    for (const id of WIDGET_IDS) {
      expect(resolveWidgetId(id)).toEqual({ found: id });
    }
  });

  it('forgives case and punctuation', () => {
    expect(resolveWidgetId('Snake')).toEqual({ found: 'snake' });
    expect(resolveWidgetId('Suika')).toEqual({ found: 'suika' });
    expect(resolveWidgetId('Flappy Bird')).toEqual({ found: 'flappy-bird' });
    expect(resolveWidgetId("Newton's Cradle")).toEqual({ found: 'newtons-cradle' });
    expect(resolveWidgetId('space_invaders')).toEqual({ found: 'space-invaders' });
  });

  it('accepts a prefix that can only mean one widget', () => {
    expect(resolveWidgetId('flap')).toEqual({ found: 'flappy-bird' });
    expect(resolveWidgetId('bubble')).toEqual({ found: 'bubble-wrap' });
  });

  it('accepts a fragment from the middle when only one widget contains it', () => {
    expect(resolveWidgetId('invaders')).toEqual({ found: 'space-invaders' });
    expect(resolveWidgetId('cradle')).toEqual({ found: 'newtons-cradle' });
  });

  // Guessing between four games is worse than naming the four.
  it('refuses an ambiguous input and says what it could have meant', () => {
    const match = resolveWidgetId('s');
    expect(match.found).toBeNull();
    expect(match.found === null && match.candidates).toEqual([
      'snake',
      'simon',
      'suika',
      'space-invaders',
    ]);
  });

  it('has nothing to suggest for an input that matches nothing', () => {
    expect(resolveWidgetId('asteroids')).toEqual({ found: null, candidates: [] });
    expect(resolveWidgetId('')).toEqual({ found: null, candidates: [] });
    expect(resolveWidgetId('---')).toEqual({ found: null, candidates: [] });
  });

  // An exact id always wins, even when it is also a prefix of a longer one. Nothing in
  // the list is currently a prefix of another, so this guards a future pair like
  // `pong` / `pong-2` rather than anything that exists today.
  it('prefers an exact match to a longer id that starts the same way', () => {
    expect(resolveWidgetId('pong', ['pong', 'pong-deluxe'])).toEqual({ found: 'pong' });
  });
});

describe('claudeLaunch', () => {
  const SETTINGS = '{"hooks":{"Stop":[{"hooks":[{"type":"http","url":"http://x/hook"}]}]}}';

  it('spawns a real executable directly on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const exe = platform === 'win32' ? 'C:\\bin\\claude.exe' : '/usr/bin/claude';
      expect(claudeLaunch(exe, ['-p', 'hi'], platform)).toEqual({
        command: exe,
        args: ['-p', 'hi'],
      });
    }
  });

  // The bug this exists for: an npm-global install of Claude Code leaves `claude.cmd` on
  // PATH, and since Node 18.20.2 spawning a .cmd with shell:false throws EINVAL - before
  // any 'error' listener is attached, so it escapes as a stack trace rather than a
  // message. Batch shims have to go through the interpreter.
  it('routes a Windows batch shim through the command interpreter', () => {
    for (const shim of ['C:\\npm\\claude.cmd', 'C:\\npm\\claude.bat', 'C:\\npm\\CLAUDE.CMD']) {
      const launch = claudeLaunch(shim, ['--settings', SETTINGS, '-c'], 'win32');
      expect(launch.command).toMatch(/cmd\.exe$/i);
      expect(launch.args).toEqual(['/d', '/s', '/c', shim, '--settings', SETTINGS, '-c']);
    }
  });

  // Arguments are handed over as separate argv entries, never concatenated into a string:
  // the settings payload is JSON full of double quotes, and Node's own quoting is the
  // thing keeping us out of the escaping business.
  it('never mangles the arguments it passes on', () => {
    const args = ['--settings', SETTINGS, '-p', 'fix A & B', '--model', 'opus'];
    expect(claudeLaunch('C:\\npm\\claude.cmd', args, 'win32').args.slice(3)).toEqual([
      'C:\\npm\\claude.cmd',
      ...args,
    ]);
  });

  // A .cmd on a machine that has no command interpreter is not a thing, but the extension
  // check must not fire off Windows either - a POSIX file may legitimately end in .bat.
  it('leaves a .cmd alone when the platform is not Windows', () => {
    expect(claudeLaunch('/opt/claude.cmd', [], 'linux')).toEqual({
      command: '/opt/claude.cmd',
      args: [],
    });
  });
});

describe('the widget list the CLI names', () => {
  // `arcade play` validates against this list without asking the app, so a widget missing
  // from it is a widget you cannot play even though it shows up in the rotation.
  it('is the same list the renderer can actually build', () => {
    expect(Object.keys(WIDGET_REGISTRY)).toEqual([...TOY_IDS, ...GAME_IDS]);
  });
});
