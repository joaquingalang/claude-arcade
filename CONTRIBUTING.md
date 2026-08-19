# Contributing

Claude Arcade is a desk toy. The bar for a change is not "does it work" but "does it stay
out of the way" - this thing sits in the critical path of someone else's Claude Code
session, and the worst bug we can ship is one that makes their terminal worse.

Read the [README](README.md) first; it explains the architecture and the reasoning behind
it. This file covers how to work on the code.

## Setup

```bash
npm install
npm run build
npm run link   # optional: builds, then puts `arcade` on your PATH
```

Node 18+. The repo is an npm workspace with three packages, so install and build at the
root - `npm install` inside a package will not do what you want.

`npm run link` symlinks the `@claude-arcade/cli` workspace into npm's global prefix, so
`arcade` runs this checkout from any directory. It resolves the Electron app by walking up
from its own `__dirname`, which survives the symlink - move the repo and it breaks, and
re-running `npm run link` from the new location fixes it. `npm run unlink` removes it.

On Windows, PowerShell will refuse to run the linked `arcade.ps1` shim under the default
`Restricted` execution policy. The README has the fix; `arcade.cmd` works either way.

The day-to-day loop:

```bash
npm test                     # vitest, runs against source - no build needed
npm run typecheck            # tsc --build across all three packages
npm run build                # shared + cli (tsc) and app (vite + tsc)
ARCADE_DEBUG=1 npm run app   # just the Electron app, renderer logs to stderr
```

`npm test` currently runs 436 tests across 10 files in about three seconds. Keep it that
fast; these tests are meant to be run constantly, so nothing in `tests/` should sleep, bind
a port, or launch Electron.

To exercise the real thing end to end you need Claude Code installed:

```bash
npm run link                 # or, without installing: npm run build && npm run arcade
arcade doctor                # install path, app package, build freshness, port, /ping
arcade play suika            # put one widget up with no session behind it
```

`arcade doctor` is the first thing to run when something looks wrong, and it is worth
extending whenever you add a piece of state that could get stuck. `arcade play` is the
fastest way to look at one widget in its real window, and `arcade stop` hands the window
back to the rotation.

For drawing work, there is also a browser harness that renders every widget at once with
no Electron involved. Run `npx vite` from `packages/app` and open `/harness.html`; it takes
`?only=snake,pong` to narrow the list and `?sound=1` to turn sound on, since there is no
`config.json` to read from there.

## Layout

```
packages/
  shared/   protocol types, widget ids, reserved port range, runtime.json helpers
  cli/      the `arcade` command
  app/      Electron main + preload + a React shell around one 2D canvas
tests/      vitest, importing source directly
```

Two boundaries are load-bearing:

- **Main never imports renderer code.** Pulling React and the DOM into the main process
  is how this gets slow and fragile. The cost is a small amount of duplication (see
  widget ids below), paid for with a test.
- **Anything two packages must agree on lives in `packages/shared`.** Wire shapes go in
  `shared/src/protocol.ts`, not in a cast. The widget ids are there for the same reason:
  `arcade play snake` has to know an id is real before it posts it, and has to list the
  ids without starting Electron to ask.

## Adding a widget

This is the most likely reason you are here. It is three edits and a test run:

1. **A new file** in `packages/app/src/renderer/widgets/`, exporting a class that extends
   `CanvasWidget` from `./types`. You implement `init()`, `update(dt)`, and `draw()`; the
   base class owns the `requestAnimationFrame` loop, clears the canvas each frame, and
   clamps `dt` to 50ms so a long pause doesn't teleport everything.
2. **An id in `packages/shared/src/widgets.ts`**, in `TOY_IDS` or `GAME_IDS` depending on
   which it is. `main/widget-ids.ts` re-exports both lists and adds the part only main has
   an opinion about - pacing, window bounds, keyboard, rotation order - so there is nothing
   to edit there unless your widget needs one of those.
3. **An entry in `registry.ts`**, in the same position as the id. This is the easy one to
   forget, and forgetting it means the cycle lands on an id that silently falls back to
   bubble wrap. `tests/widget-ids.test.ts` asserts the two lists match exactly, in order.

   The rotation alternates one toy, one game, so **the two lists have to stay the same
   length**. An eighth game without an eighth toy makes every game rarer than every toy,
   which is not something you would notice by watching it. There is a test for that too.

**A game must end by itself.** Everything in `GAME_IDS` is exempt from the cycle clock, so
it keeps the screen until it calls the inherited `finish()` - and a game that never calls
it holds the rotation forever. `finish()` is latched, so calling it from inside `update()`,
where the frame that ends the game may well run again before the swap lands, reports
exactly once. Give the ending some escalation while you are there: a game that can go on
indefinitely at a fixed difficulty is a game that will.

**A toy may ask the clock to wait, but only for a person.** `setHold(true)` defers the
swap; `setHold(false)` releases it. The Tower of Hanoi is the widget it exists for: pick a
disc up and the cycle waits until the tower is standing complete again, because being
moved along three moves from the end of a puzzle is the same insult `finish()` protects a
game from. The buzz wire is the second, and holds until the ring reaches the far post or
the run's three lives are spent. Three rules come with it, and there are tests for each:

- **Never hold while nobody is touching it.** A widget that holds on its own has simply
  appointed itself a game, and every toy in `toys` is checked for this.
- **Release on your own.** Hanoi lets go on a finished tower or after 15 seconds of no
  interaction - a board someone walked away from stops being theirs, and the buzz wire
  reads an untouched ring the same way.
- **The cap is not yours to set.** `CycleHold` in `main/widget-ids.ts` stops honouring any
  hold after 90 seconds, timed from the first ask so re-asking cannot extend it. The base
  class also releases on `stop()`, so a torn-down widget never leaves the clock waiting.

Constraints that are not negotiable, because they come from the window rather than from
taste:

- **Mouse only.** The window is `focusable: false` so your keystrokes keep landing in the
  terminal, which means the widget never sees a key event of its own. Handle
  `onPointerDown`, `onPointerMove` and `onPointerUp`. `onKey` exists, but it is fed by a
  *global* arrow-key grab that main registers only while a widget in `wantsKeyboard()` is
  on screen - which is Snake and Tetris, and a test spells out the list so that adding a
  third means editing something that states the cost. Taking keys off the whole desktop is
  a real cost; if a toy only makes sense with a keyboard, it is not a toy for this app, and
  if it can also be steered by the pointer, it must be - both widgets on that list are
  complete without a keyboard, and that is the condition for being on it.

  A widget that draws its own controls gets `keyboard` in `WidgetOptions`, which is main's
  answer about whether the arrows will actually arrive - `wantsKeyboard()` and the user's
  `arrowKeys` setting, together. It defaults to false, so a widget that guesses instead of
  asking is wrong in the tests and in the browser harness.
- **`pause()` must stop the loop.** The base class handles this; don't schedule your own
  `requestAnimationFrame` or `setInterval` outside it. A desk toy burning CPU while
  invisible defeats the entire point.
- **Draw inside the box.** Lay out against `this.size` (the largest square that fits).
  Reach for `this.width`/`this.height` only if the toy genuinely needs the extra room,
  and if it does, add a bounds override in `widget-ids.ts` the way Newton's cradle does.
- **Move on its own.** A toy that sits still until instructed is a chore. Games should
  play themselves until the pointer touches them. Simon is the one exception, and it had
  to earn it: a memory game cannot demo itself without spending the round it is demoing.
- **Survive nonsense input.** Pointer coordinates arrive from outside the box too
  (`-50`, `2 * SIZE`); clamping is your job.

Then add your widget to the lists at the top of `tests/widgets.test.ts` - `toys` if it is
one, `widgets` directly if it is a game. Everything in `widgets` runs through the same
contract: draws every frame without throwing, `pause()` freezes the loop, `resume()` is
idempotent, pointer events anywhere in or out of the box are survivable, and 600 frames
leave it numerically stable. Everything in `toys` additionally has to prove it *never*
reports done and *never* asks the clock to wait while it is playing itself, since the clock
is what moves a fidget toy along. Add a behaviour test of
your own underneath for whatever makes your toy interesting - popping, friction, scoring -
and for a game, one that holds it to ending however well it is played.

### Sound

Silent by default, and that default is a constraint rather than a setting: a widget must
be completely playable with sound off. Simon is the shape to copy - its four pitches
duplicate its four colours rather than carrying half the information.

`renderer/audio.ts` owns all of it, over **one shared `AudioContext`**. Don't build a
second one; `suspendSound()` would need a list of them that the next noisy widget would
quietly fall off. Samples go through `SoundBank`, which loads each file independently and
skips what is missing - an install with no mp3s must pop silently rather than throw.
Synthesised voices extend `Synth`, and that is the default choice for anything whose
pitches *are* the toy, because it is audible the moment sound is switched on with nothing
to download.

Sample bytes are read by the **main** process (`main/samples.ts`) and passed over IPC. That
is not a detour: the packaged renderer is loaded with `loadFile`, and Chromium's `fetch`
refuses the `file:` scheme outright. `readSample` takes a bare filename that must resolve
inside the sounds directory and nothing else - keep it that way. The Vite harness is served
over http and fetches directly, so both paths need to keep working.

## Changing session or hook behaviour

The state machine in `packages/app/src/main/session-store.ts` decides when the widget is
visible, and it is the part most worth being careful with. The README has the full event
table. Three rules it encodes:

- **Unknown events are ignored, never rejected.** A Claude Code release that adds a hook
  event must not break the widget.
- **`Notification` / `PermissionRequest` / `Elicitation` hide immediately.** Claude is
  asking the user something; a toy covering the prompt is actively harmful.
- **Not every `Stop` is a completion.** `stop_hook_active` means a Stop hook itself
  continued the turn.

Subscribing to a new event means adding it to `SUBSCRIBED_EVENTS` in
`packages/shared/src/protocol.ts` (the CLI builds one HTTP hook per entry) and handling
it in the store's `switch`. Cover it in `tests/session-store.test.ts`, which drives the
store with an injected clock - no real timers.

## Changing the CLI

`arcade` is argument passthrough with five words reserved in first position - `play`,
`stop`, `list`, `doctor`, `--no-widget`. Reserving a sixth is a breaking change for anyone
whose prompt starts with that word, so the bar is high, and `parseCommand` in
`packages/cli/src/commands.ts` is where it would go. `tests/commands.test.ts` covers the
parsing and the loose id matching, which resolves case- and punctuation-insensitively by
prefix then fragment, and only when exactly one widget matches - an ambiguous input has to
list the candidates rather than guess.

## Invariants

Changes that break any of these need a very good argument:

- **Loopback only.** Bind and connect to `127.0.0.1`, inside ports 45970-45979. Never
  `0.0.0.0`, never a port outside the range (23333-23337 belongs to another Claude Code
  companion app).
- **Never read or write `~/.claude/settings.json`.** Hooks are injected per-session
  through `claude --settings <json>`. This is why the app coexists with other hook-based
  tools and why plain `claude` in another terminal shows nothing.
- **Hooks stay `async: true` and answer before doing work.** The server writes its `204`
  before touching a window. A hook sits in Claude's critical path.
- **Failure means "run Claude unwrapped", not "fail".** If the app can't be found or
  started, the CLI still spawns `claude` with `stdio: 'inherit'`. Nobody's session dies
  because the toy didn't load.
- **The token is correlation, not authentication.** Don't build a security story on it;
  the boundary is loopback.

## Style

TypeScript, `strict` plus `noUncheckedIndexedAccess` - the non-null assertions you see
after array indexing are deliberate, not sloppiness. Single quotes, semicolons, 2-space
indent, trailing commas, ~100 column lines. Imports go builtins, then packages, then
local, separated by blank lines.

Comments explain *why*, not *what*. Most of the comments in this codebase exist because
the obvious implementation was wrong for a reason that isn't visible from the code - the
`dt` clamp, the drag position being stored as the base square's corner, the two widget
lists. If your change is one of those, leave the note behind.

Dependencies are close to the bone on purpose (React, zustand, Electron, and that is
about it). A new runtime dependency needs a reason a hundred lines of code wouldn't
satisfy.

## Before you send a change

There is no CI, so this is on you:

```bash
npm test
npm run typecheck
npm run build
```

Then run it for real - `npm run arcade`, give Claude something slow to do, and watch the
toy appear and disappear. The tests cover the state machine and the widgets, but they
can't tell you the thing feels right on screen, and that is the whole product.
</content>
