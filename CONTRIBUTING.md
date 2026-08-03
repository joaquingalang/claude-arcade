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

The day-to-day loop:

```bash
npm test                     # vitest, runs against source - no build needed
npm run typecheck            # tsc --build across all three packages
npm run build                # shared + cli (tsc) and app (vite + tsc)
ARCADE_DEBUG=1 npm run app   # just the Electron app, renderer logs to stderr
```

`npm test` currently runs 119 tests across 6 files in about a second. Keep it that fast;
these tests are meant to be run constantly, so nothing in `tests/` should sleep, bind a
port, or launch Electron.

To exercise the real thing end to end you need Claude Code installed:

```bash
npm run link                 # or, without installing: npm run build && npm run arcade
arcade doctor                # install path, app package, build freshness, port, /ping
```

`arcade doctor` is the first thing to run when something looks wrong, and it is worth
extending whenever you add a piece of state that could get stuck.

## Layout

```
packages/
  shared/   protocol types, reserved port range, runtime.json helpers
  cli/      the `arcade` command
  app/      Electron main + preload + a React shell around one 2D canvas
tests/      vitest, importing source directly
```

Two boundaries are load-bearing:

- **Main never imports renderer code.** Pulling React and the DOM into the main process
  is how this gets slow and fragile. The cost is a small amount of duplication (see
  widget ids below), paid for with a test.
- **Anything on the wire lives in `packages/shared`.** If the CLI and the app both need
  to agree on a shape, it belongs in `shared/src/protocol.ts`, not in a cast.

## Adding a widget

This is the most likely reason you are here. It is three edits and a test run:

1. **A new file** in `packages/app/src/renderer/widgets/`, exporting a class that extends
   `CanvasWidget` from `./types`. You implement `init()`, `update(dt)`, and `draw()`; the
   base class owns the `requestAnimationFrame` loop, clears the canvas each frame, and
   clamps `dt` to 50ms so a long pause doesn't teleport everything.
2. **An entry in `registry.ts`**, with a human-readable label. Order matters only in that
   it has to match the id list below.
3. **An id in `packages/app/src/main/widget-ids.ts`**, in `TOY_IDS` or `GAME_IDS`
   depending on which it is, and in the same position. This is the easy one to forget,
   and forgetting it means the cycle lands on an id that silently falls back to bubble
   wrap. `tests/widget-ids.test.ts` asserts the two lists match exactly, in order.

   The rotation alternates one toy, one game, so **the two lists have to stay the same
   length**. A fourth game without a fourth toy makes every game rarer than every toy,
   which is not something you would notice by watching it. There is a test for that too.

Constraints that are not negotiable, because they come from the window rather than from
taste:

- **Mouse only.** The window is `focusable: false` so your keystrokes keep landing in the
  terminal, which means the widget never sees a key event. Handle `onPointerDown`,
  `onPointerMove`, `onPointerUp` and nothing else. If a toy only makes sense with a
  keyboard, it is not a toy for this app - Snake steers toward the pointer for exactly
  this reason.
- **`pause()` must stop the loop.** The base class handles this; don't schedule your own
  `requestAnimationFrame` or `setInterval` outside it. A desk toy burning CPU while
  invisible defeats the entire point.
- **Draw inside the box.** Lay out against `this.size` (the largest square that fits).
  Reach for `this.width`/`this.height` only if the toy genuinely needs the extra room,
  and if it does, add a bounds override in `widget-ids.ts` the way Newton's cradle does.
- **Move on its own.** A toy that sits still until instructed is a chore. Games should
  play themselves until the pointer touches them.
- **Survive nonsense input.** Pointer coordinates arrive from outside the box too
  (`-50`, `2 * SIZE`); clamping is your job.

Then add your widget to the shared list at the top of `tests/widgets.test.ts`. Every toy
runs through the same contract: draws every frame without throwing, `pause()` freezes the
loop, `resume()` is idempotent, pointer events anywhere in or out of the box are
survivable, and 600 frames leave it numerically stable. Add a behaviour test of your own
underneath for whatever makes your toy interesting - popping, friction, scoring.

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
