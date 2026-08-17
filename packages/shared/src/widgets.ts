/**
 * The widget ids, in the one place both sides of the wire can see them.
 *
 * They used to live in the app, because only the app ever needed to name a widget. Then
 * `arcade play snake` made them part of the CLI's contract too: the command has to know
 * an id is real before it posts it, and it has to be able to list the ids without
 * starting an Electron app just to ask. A third hand-maintained copy of the list is
 * exactly the kind of thing that drifts, so the list moved here instead.
 *
 * The renderer keeps its own registry - main must not import React - and a test holds the
 * two in step. See `app/src/renderer/widgets/registry.ts`.
 */

/** The fidget toys: no end state, so the clock moves them along. */
export const TOY_IDS = [
  'bubble-wrap',
  'fidget-spinner',
  'newtons-cradle',
  'falling-sand',
  'tower-of-hanoi',
  'thumb-piano',
] as const;

/** The games: they run to their own ending and report in when they get there. */
export const GAME_IDS = [
  'snake',
  'flappy-bird',
  'pong',
  'simon',
  'suika',
  'space-invaders',
] as const;

export const WIDGET_IDS = [...TOY_IDS, ...GAME_IDS] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export function isWidgetId(id: string): id is WidgetId {
  return (WIDGET_IDS as readonly string[]).includes(id);
}
