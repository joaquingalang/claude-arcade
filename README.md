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

## Quick start

You need Node 18+ and Claude Code already installed - `claude --version` should answer
before you start, because `arcade` only wraps a `claude` it can find.

```bash
npm install
npm run link     # builds, then puts `arcade` on your PATH
```

Then, from any directory:

```bash
arcade
```

`npm run link` points the global command at *this folder* - moving or deleting the repo
breaks `arcade` everywhere, and re-running `npm run link` from the new location repairs
it. `npm run unlink` takes it back off your PATH.

Without installing, `npm run build && npm run arcade` does the same thing from the repo
root.

Everything after `arcade` is passed straight through to `claude`:

```bash
arcade                       # interactive session
arcade -p "fix the tests"    # one-shot
arcade --no-widget           # plain claude, no widget
arcade doctor                # check the wiring
```

`arcade doctor` is the one command to run after linking. `status : ready` means the CLI
found `claude`, found the app package, and got a `/ping` back:

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

### Windows and PowerShell

`npm link` writes three shims into npm's global directory: `arcade` (for Git Bash),
`arcade.cmd` (for cmd.exe), and `arcade.ps1`. PowerShell picks the `.ps1`, and Windows
clients ship with the `Restricted` execution policy, which refuses to run *any* `.ps1`.
So a freshly linked `arcade` can fail on someone else's machine with:

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
accounts or for services. Confirm what you actually have with:

```powershell
Get-ExecutionPolicy -List
```

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

The widget itself needs a desktop session to draw into. Over plain SSH or in a container
with no display there is nothing to show; `ensureApp()` gives up after 6s and Claude runs
unwrapped, which is the designed outcome rather than an error.

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

## Widgets

| id | interaction | ends when |
|---|---|---|
| `bubble-wrap` | click or drag to pop; refills when empty | never - on the clock |
| `fidget-spinner` | drag to flick; friction spins it down | never - on the clock |
| `newtons-cradle` | drag a ball out and release | never - on the clock |
| `snake` | arrow keys, or point where you want it to go | 3 lives spent |
| `flappy-bird` | click to flap | 3 lives spent |
| `pong` | move the pointer to slide your paddle | someone reaches 5 |

The fidget toys are driven by the pointer alone, because the window never has keyboard
focus. Snake and Pong play themselves until you touch them - a toy that sits still until
instructed is a chore.

### Snake and the arrow keys

Arrows are what Snake is actually played with, and a `focusable: false` window receives no
keydown at all. So the main process registers the four arrow keys as **global**
accelerators and forwards them in - but only while Snake is the widget on screen.

That is a real trade against the guarantee in the section above, stated plainly: **while a
snake is visible, the arrow keys go to the snake instead of your terminal.** Shell history
and cursor movement are affected; ordinary typing is not. Three things bound it:

- **Arrows only, never letters.** WASD would eat normal typing.
- **Registered as late as possible** - not at launch, not merely while the window is up,
  only while the widget showing is Snake. It is handed back on hide, on rotation, and on
  quit.
- **`snakeKeyboard: false`** in `config.json` turns it off completely.

Pointer steering still works either way, and the last input you used is the one driving,
so turning the grab off leaves a fully playable toy rather than a broken one. Walls still
wrap: self-collision is the only way to die.

Adding one is a new file in `packages/app/src/renderer/widgets/`, an entry in
`registry.ts`, and an id in `main/widget-ids.ts`. The last of those is easy to forget:
main can't import the renderer registry without pulling React into the main process, so
the two lists are kept in sync by a test rather than by the type system.

A widget that should run to an end rather than to the clock goes in `SELF_PACED` in the
same file and calls the inherited `finish()` when its run is over. `finish()` is latched,
so calling it from inside `update()` - where the frame that ends the game may well run
again before the swap lands - reports exactly once.

Each toy gets a 280px square unless `widget-ids.ts` says otherwise. Newton's cradle is
the one exception at 400x280 - at rest it fits the square, but a full swing carries the
outer balls past both edges. The wider box grows around the square's centre and is
clamped into the work area, so a toy that needs the room still appears where you parked
it instead of half off the screen.

**The rotation alternates a fidget toy and a game**, starting on a toy, and picks at
random within each kind. Not plain random picking, though: that clusters, so you get
three games in a row and then no Snake for twenty minutes. Each kind draws from a shuffle
bag instead - a lap of its ids in random order, refilled only once it is empty - so every
widget comes up exactly as often as every other over a working day while the order stays
unguessable. The seam between two laps is the one place a repeat could sneak in, so a lap
never opens with the id the previous one closed on.

The alternation is not reset when the widget hides. Short turns show one widget and go
away again, and starting over at a toy each time is how you would end up never seeing a
game. The cycle clock is armed when the window appears and re-armed on each swap, so a
turn full of tool calls can't keep resetting it. Pin `widget` to a specific id and it
stays put - a pinned widget is a choice, not a suggestion.

**How long each toy gets depends on which kind it is.** The fidget toys have no end state,
so the clock moves them along after `cycleMs`. The three games do have one, and they keep
the screen until they reach it: three lives for Snake and Flappy Bird, first to five for
Pong. Being pulled off court at 4-3 is worse than never having played, which is the whole
reason for the split - a game interrupted by a timer wastes the time it was meant to fill.
The flip side is that a game has to actually end: Pong's ball gains speed on every paddle
hit *and* carries that escalation into the next serve, so a match winds itself up towards
a result rather than settling into rallies that never resolve.

A finished game reports in and the cycle moves on. When rotation is off - a pinned widget,
or `cycleMs: 0` - it restarts in place instead, because leaving a dead board up for the
rest of a long turn would be the worst of both worlds.

Hovering reveals a dismiss button in the top-right corner. Dismissing hides the toy for
the rest of the current stretch of work; the next turn brings it back. It is a "not now",
not an off switch.

A strip along the top edge drags the window, and where you drop it is remembered.
`-webkit-app-region: drag` is unreliable on a transparent non-focusable window, so the
renderer reports pointer events and main moves the window using the *screen* cursor
position - a non-focusable window stops receiving pointer events the moment the cursor
outruns it. What gets saved is the base square's corner rather than the raw window
position, so parking the cradle and then getting Pong doesn't shift the toy sideways.

All of it lives in `config.json` under Electron's `userData` directory:

| key | default | meaning |
|---|---|---|
| `widget` | `random` | a widget id, or `random` |
| `showDelayMs` | `2500` | how long a turn must run before anything appears |
| `cycleMs` | `15000` | time on screen per fidget toy; `0` disables cycling. Games ignore it |
| `snakeKeyboard` | `true` | let Snake take the arrow keys system-wide while it is on screen |
| `position` | `null` | where you dragged it; `null` means bottom-right of the work area |
| `soundEnabled` | `false` | reserved - nothing reads it yet |

## When the widget shows

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
silent for two minutes whose launching process is gone gets dropped. Without it the toy
would sit on screen forever waiting for a turn that already died.

## Layout

```
packages/
  shared/   protocol types, reserved port range, runtime.json helpers
  cli/      the `arcade` command
  app/      Electron main + preload + a React shell around one 2D canvas
tests/      vitest, run against source
```

## Development

```bash
npm test                  # 142 tests across 6 files
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

Useful env vars:

- `ARCADE_CLAUDE_PATH` - point at a specific `claude` executable
- `ARCADE_APP_PATH` - point at a packaged app instead of the dev layout
- `ARCADE_DEBUG` - log renderer console output to stderr

Ports 45970-45979 are reserved. Loopback only. The range deliberately avoids 23333-23337,
where Clawd on Desk lives - colliding with another Claude Code companion app would make
both fail depending on start order.

## Not yet

Sounds, themes, statistics, SQLite, PixiJS, plugin API.
