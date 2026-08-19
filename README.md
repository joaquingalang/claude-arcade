# Claude Arcade

A tiny interactive toy that appears while Claude Code is thinking, and disappears the
moment it stops.

Not a productivity app. A digital desk toy.

```
you: "refactor the auth module"
     ...2.5 seconds pass...
     a small bubble-wrap sheet fades in beside your terminal
     you pop bubbles
     Claude finishes -> it vanishes
```

## Requirements

| | |
|---|---|
| Node | 18 or newer (`node --version`) |
| Claude Code | already installed and working - `claude --version` must answer |
| Desktop session | the widget is an Electron window, so it needs a screen to draw into |
| OS | Windows, macOS or Linux |

`arcade` only wraps a `claude` it can find, so get `claude --version` answering before you
start. Over plain SSH or in a container with no display there is nothing to show; the CLI
gives up after 6s and runs Claude unwrapped, which is the designed outcome rather than an
error.

## Installation

**1. Clone and install.**

```bash
git clone https://github.com/joaquingalang/claude-arcade.git
cd claude-arcade
npm install
```

This is an npm workspaces repo - one `npm install` at the root covers all three packages.
Electron downloads a browser binary on first install, so expect it to take a minute.

**2. Put `arcade` on your PATH.**

```bash
npm run link
```

That builds all three packages and then `npm link`s the CLI globally. It points the global
command at *this folder* - moving or deleting the repo breaks `arcade` everywhere, and
re-running `npm run link` from the new location repairs it.

**3. Check the wiring.**

```bash
arcade doctor
```

`status : ready` means the CLI found `claude`, found the app package, and got a `/ping`
back:

```
Claude Arcade doctor
  claude executable : C:\Users\you\.local\bin\claude.exe
  install path      : C:\Users\you\code\claude-arcade\packages\cli
  app package       : C:\Users\you\code\claude-arcade\packages\app
  build             : up to date
  runtime.json      : present
  app port          : 45970
  /ping             : ok
  status            : ready
```

`status : degraded` before you have ever run `arcade` is normal - it just means the app
isn't up yet. The first `arcade` run starts it.

**4. Use it.** From any directory, `arcade` is `claude` with a toy attached:

```bash
arcade                       # interactive session
arcade -p "fix the tests"    # one-shot
arcade --no-widget           # plain claude, no widget
arcade play snake            # put a widget up right now
```

Everything after `arcade` is passed straight through to `claude`. Five words are the
wrapper's own - `play`, `stop`, `list`, `doctor` and `--no-widget` - and only in first
position, so `arcade -p "play snake"` is still a prompt for Claude. If you want the
`claude` subcommand of the same name, `arcade --no-widget doctor` gets you there.

**To uninstall**, `npm run unlink` takes it back off your PATH. Nothing else to undo:
Claude Arcade never writes to `~/.claude/settings.json`, and its own state lives in
`~/.claude-arcade/` and Electron's `userData` directory.

### Trying it without installing

From the repo root, this does the same thing without touching your PATH:

```bash
npm run build && npm run arcade
```

### Windows and PowerShell

`npm link` writes three shims into npm's global directory: `arcade` (for Git Bash),
`arcade.cmd` (for cmd.exe), and `arcade.ps1`. PowerShell picks the `.ps1`, and Windows
clients ship with the `Restricted` execution policy, which refuses to run *any* `.ps1`.
So a freshly linked `arcade` can fail with:

```
arcade : File C:\...\npm\arcade.ps1 cannot be loaded because running scripts is
disabled on this system.
```

The wiring is fine; PowerShell just won't execute the shim. Two ways past it.

**Allow locally-written scripts for your own user.** One time, no admin prompt, no
elevation:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

`RemoteSigned` runs scripts you wrote or installed locally - which is exactly what an npm
shim is - while still requiring a valid signature on anything carrying the
mark-of-the-web from a download or email attachment. `-Scope CurrentUser` writes to your
own profile and leaves machine-wide policy `Undefined`, so nothing changes for other
accounts or for services. Confirm what you actually have with `Get-ExecutionPolicy -List`.

Do not reach for `Unrestricted` or `Bypass`, and do not pass `-Scope LocalMachine`. Those
disable the check for every script from every source, machine-wide, to fix a problem that
`RemoteSigned` at user scope already fixes.

**Or change nothing at all** and call the cmd shim, which isn't a PowerShell script and
so isn't subject to the policy:

```powershell
arcade.cmd doctor
```

This is the right choice on a locked-down or managed machine where execution policy is
set by Group Policy - if `Get-ExecutionPolicy -List` shows `MachinePolicy` or `UserPolicy`
as anything but `Undefined`, your `Set-ExecutionPolicy` will be overridden anyway.

**If PowerShell can't find `arcade` in any form**, npm's global directory is missing from
your PATH. Find it and check:

```powershell
npm prefix -g                                  # e.g. C:\Users\you\AppData\Roaming\npm
$env:Path -split ';' | Select-String 'npm'
```

Add it through *Settings > System > About > Advanced system settings > Environment
Variables*, under your user's `Path`, then open a new terminal - PATH is read at process
start, so an already-open one will keep not finding it.

**On nvm4windows** (and nvm-desktop), the global directory lives inside the active Node
version rather than in `%APPDATA%`, so switching versions makes `arcade` vanish. It isn't
broken - re-run `npm run link` under the version you want to use it from.

**If `claude` itself came from npm**, what is on your PATH is `claude.cmd`, and Node has
refused to spawn a `.cmd` or `.bat` without a shell since 18.20.2 - it throws `EINVAL`, and
it throws *synchronously*, before there is an `error` listener to turn that into a sentence.
So a batch shim is run through `cmd /d /s /c` and a real `claude.exe` is spawned directly.

Naming cmd rather than passing `shell: true` is the load-bearing part. `shell: true` flattens
the arguments into one string, and cmd does not know a `\"` from a `"` - it eats every quote
in the injected `--settings` JSON and splits a prompt like `fix A & B` at the ampersand.
Handing cmd its arguments as separate argv entries keeps Node's own quoting, and the whole
2KB payload reaches Claude byte for byte.

## Widgets

Fourteen toys, split between fidget toys that run on a clock and games that run to an end.
All of them are mouse-only, because the window never takes keyboard focus.

| id | interaction | ends when |
|---|---|---|
| `bubble-wrap` | click or drag to pop; refills when empty | never - on the clock |
| `fidget-spinner` | drag to flick; friction spins it down | never - on the clock |
| `newtons-cradle` | drag a ball out and release | never - on the clock |
| `falling-sand` | drag to pour; it piles and avalanches | never - on the clock |
| `tower-of-hanoi` | it solves itself; drag a disc to take over | on the clock, unless you are mid-solve |
| `thumb-piano` | press a tine, or drag across them to play a run | never - on the clock |
| `buzz-wire` | it runs the ring along; take it and steer to the far post | on the clock, unless you are mid-run |
| `snake` | arrow keys, or point where you want it to go | 3 lives spent |
| `flappy-bird` | click to flap | 3 lives spent |
| `pong` | move the pointer to slide your paddle | someone reaches 5 |
| `simon` | click to start, then the pads back in the order they flashed | a wrong pad, 8 rounds, or never started |
| `suika` | point to aim, click to drop; same fruit fuse | the basket empties, or the jar overflows |
| `space-invaders` | the pointer steers; the ship fires itself | 2 waves cleared, or 3 lives |
| `tetris` | arrow keys, or point to slide, tap to turn, hold to drop | 12 lines, or the stack tops out |

Most of the games play themselves until you touch them - a toy that sits still until
instructed is a chore. Simon is the exception, because a memory game cannot demo itself:
it waits with a play mark in the hub, and hands the rotation on if nobody starts it.

**The rotation alternates a fidget toy and a game**, starting on a toy, and picks at random
within each kind - from a shuffle bag rather than plain random, so everything comes up
about as often as everything else without the order being guessable. Fidget toys move
along after `cycleMs`; games keep the screen until they reach their end, because being
pulled off court at 4-3 is worse than never having played. A finished game hands over to
the next widget, or restarts in place if rotation is off.

**A toy you are in the middle of can ask the clock to wait.** Pick up a disc on the Tower
of Hanoi and the swap holds off until the tower is standing complete again - being moved
along three moves from the end of a puzzle is the same insult as losing a game at 4-3. The
buzz wire asks for the same thing, and holds until the ring reaches the far post. The wait
ends on its own if you leave either of them alone for 15 seconds, and never runs past 90
seconds whatever happens. Left untouched, the toy is on `cycleMs` like every other one:
this is for a person mid-something, not a way for a toy to promote itself to a game.

Hovering reveals a dismiss button in the top-right corner. Dismissing hides the toy for
the rest of the current stretch of work; the next turn brings it back. It is a "not now",
not an off switch. A strip along the top edge drags the window, and where you drop it is
remembered - including which monitor you left it on.

### Playing one on purpose

The rotation decides what shows up while Claude works. `arcade play` is the override:

```bash
arcade list                  # the ids you can play
arcade play snake            # put it up and leave it up
arcade play Suika            # ids are matched loosely - case and punctuation are ignored
arcade stop                  # hand the window back to the rotation
```

`arcade play` is the one command that shows a widget with no Claude session behind it, so
it starts the app if the app isn't running. It outranks session state in both directions -
the widget appears with nothing working, and stays put through a turn that would otherwise
have rotated it away - because `arcade play snake` is someone deciding they want a game,
not a hint about what to show next time Claude is busy.

Ids are matched on case- and punctuation-insensitive prefix, then any fragment, but only
when exactly one widget matches: `flap` and `invaders` work, `s` gets you a list of the
four widgets starting with it.

### Sound

Everything is silent by default, and that default is the important part: a desk toy that
beeps while you are on a call is a toy you uninstall. Turn it on with
`"soundEnabled": true` in `config.json`; the flag is read on every appearance, so the edit
lands on the next show rather than the next launch.

Five widgets make a noise. **Bubble wrap plays samples** - four files named `pop-1.mp3`
through `pop-4.mp3` in `packages/app/src/renderer/public/sounds/` (see the README there for
what makes a good one). Missing files are not an error; an install with no samples pops
silently. **The Tower of Hanoi, thumb piano, buzz wire and Simon synthesise**, so they are
audible the moment sound is switched on with nothing to download.

Sound never carries information the picture doesn't - Simon's four pitches duplicate its
four colours rather than replacing them - so every widget is fully playable with sound off.

### The arrow keys

Arrows are what Snake and Tetris are actually played with, and a non-focusable window
receives no keydown at all. So the main process registers the four arrow keys as
**global** accelerators - but only while one of those two is the widget on screen.

That is a real trade, stated plainly: **while Snake or Tetris is visible, the arrow keys
go to the widget instead of your terminal.** Shell history and cursor movement are
affected; ordinary typing is not. Three things bound it: arrows only and never letters;
registered only while a widget that asked for them is showing, and handed back on hide,
rotation and quit; and `"arrowKeys": false` in `config.json` turns it off entirely.

Both widgets are complete under the pointer, which is the price of being on that list -
turning the grab off costs you a control scheme, not a game. Tetris says which one you
have in the legend it opens with, so a desk that turned the arrows off is never taught a
key that does nothing.

## Configuration

All of it lives in `config.json` under Electron's `userData` directory - `arcade doctor`
prints the path.

| key | default | meaning |
|---|---|---|
| `widget` | `random` | a widget id, or `random` |
| `showDelayMs` | `2500` | how long a turn must run before anything appears |
| `cycleMs` | `15000` | time on screen per fidget toy; `0` disables cycling. Games ignore it |
| `arrowKeys` | `true` | let Snake and Tetris take the arrow keys system-wide while on screen |
| `position` | `null` | where you dragged it; `null` means bottom-right of the work area |
| `soundEnabled` | `false` | let widgets make a noise. Read on every show |

## How it works

```
arcade "fix the tests"
   │
   ├─ 1. find a running app via ~/.claude-arcade/runtime.json, or start one
   │      (/ping must answer `app: claude-arcade` before the port is trusted)
   │
   ├─ 2. POST /session-registered  { launcherPid, cwd, token }
   │
   ├─ 3. build inline settings JSON with http hooks
   │        -> http://127.0.0.1:<port>/hook?token=<token>
   │
   ├─ 4. spawn claude --settings '<json>' [...your args]   (stdio: inherit)
   │                 │
   │                 │  hooks POST directly - no process spawn per event
   │                 ▼
   │     Claude Arcade (Electron main)
   │       HTTP server -> SessionStore state machine
   │                           │
   │                  2.5s delay timer / immediate hide
   │                           ▼
   │                floating window (showInactive)
   │
   └─ 5. POST /session-ended { token }  when claude exits
```

The token is correlation, not authentication - it ties hook events back to the terminal
that launched them so the watchdog knows whose pid to watch. The real boundary is that
nothing is ever bound or connected to anything but loopback.

Four design choices carry most of the weight:

**Hooks, not output parsing.** `claude --settings <json>` loads *additional* settings
and hooks merge across scopes, so the wrapper injects hooks that exist only for the
session it launched. Nothing reads or writes `~/.claude/settings.json`. Running plain
`claude` in another terminal shows no widget, and other hook-based companion apps are
completely unaffected.

**`stdio: 'inherit'`.** Because lifecycle comes from hooks, the wrapper never needs to
read Claude's output. The child gets the real console handle, so the TUI is identical to
running `claude` directly - no PTY, no ANSI parsing, no native modules.

**`focusable: false` + `showInactive()`.** The window receives mouse events but never
keyboard focus. Every keystroke keeps landing in your terminal, which is why every widget
is mouse-only.

**`async: true` hooks.** Every injected hook is fire-and-forget with a 5s timeout, and
the server writes its `204` before touching a window. A hook sits in Claude's critical
path; if this app hangs, crashes, or was never started, the session is unaffected. The
CLI holds the same line - `ensureApp()` returning null means "run Claude unwrapped", not
"fail".

### When the widget shows

| event | state | widget |
|---|---|---|
| `SessionStart` | idle | none |
| `UserPromptSubmit` | working | arm 2.5s timer |
| `PreToolUse` / `PostToolUse` / `PostToolBatch` | working | keep |
| `SubagentStart` / `SubagentStop` | working | keep |
| `PostCompact` | working (**not** completion) | keep |
| `Notification` / `PermissionRequest` / `Elicitation` | needs-user | **hide now** |
| `Stop` / `StopFailure` | done | **hide now** |
| `Stop` / `StopFailure` with `stop_hook_active` | working (re-entry) | keep |
| `PostToolUseFailure` | done | hide |
| `SessionEnd` | dropped | hide |

The 2.5s delay is the anti-flicker guarantee: a turn that finishes in under 2.5s never
shows anything. The clock starts at the first event of the turn and survives tool calls,
so a long turn full of tool activity doesn't keep pushing the appearance back.

Hiding on `Notification` / `PermissionRequest` is correctness, not polish - Claude is
asking *you* something, and a toy covering the prompt is actively harmful.

Sessions are tracked by `session_id`, and concurrent ones are normal: the widget stays up
while *any* session is working. Anything unrecognised is ignored rather than rejected, so
a Claude Code release that adds events can't break the widget.

Killing a terminal outright sends no `Stop`, so a watchdog sweeps every 15s: a session
silent for two minutes whose launching process is gone gets dropped, and the launcher
registration behind it is retired the same way. Without it the toy would sit on screen
forever waiting for a turn that already died.

## Layout

```
packages/
  shared/   protocol types, widget ids, reserved port range, runtime.json helpers
  cli/      the `arcade` command
  app/      Electron main + preload + a React shell around one 2D canvas
tests/      vitest, run against source
```

## Development

```bash
npm test                  # 333 tests across 9 files
npm run typecheck
npm run build
npm run link                 # rebuild and refresh the global `arcade` command
npm run unlink               # take it back off your PATH
ARCADE_DEBUG=1 npm run app   # run the app with renderer logging
arcade doctor                # install path, app package, build freshness, port, /ping
```

`arcade doctor` is worth running after any `npm run link`: it prints which checkout the
global command resolves to, whether the Electron app package is findable from there, and
whether `dist/` is newer than `src/`. A linked `arcade` runs `dist/index.js` directly, so
editing source without rebuilding silently runs the old code - `build : stale` is how you
find that out.

Adding a widget is a new file in `packages/app/src/renderer/widgets/`, an entry in
`registry.ts`, and an id in `shared/src/widgets.ts`. The last of those is easy to forget:
main can't import the renderer registry without pulling React into the main process, so
the two lists are kept in sync by a test rather than by the type system. The ids sit in
`shared` because `arcade play` needs them too - it has to know an id is real before it
posts it. `main/widget-ids.ts` re-exports them alongside the part only main has an opinion
about: pacing, window size, and rotation order. A widget that runs to an end rather than to
the clock goes in `SELF_PACED` and calls the inherited `finish()` when its run is over.

Each toy gets a 280px square unless `widget-ids.ts` says otherwise; Newton's cradle is the
one exception at 400x280, because a full swing carries the outer balls past both edges.

Useful env vars:

- `ARCADE_CLAUDE_PATH` - point at a specific `claude` executable
- `ARCADE_APP_PATH` - point at a packaged app instead of the dev layout
- `ARCADE_DEBUG` - log renderer console output to stderr

Ports 45970-45979 are reserved. Loopback only. The range deliberately avoids 23333-23337,
where Clawd on Desk lives - colliding with another Claude Code companion app would make
both fail depending on start order.

## Not yet

Themes, statistics, SQLite, PixiJS, plugin API.
</content>
</invoke>
