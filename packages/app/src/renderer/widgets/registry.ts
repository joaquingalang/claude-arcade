import { BubbleWrap } from './bubble-wrap';
import { BuzzWire } from './buzz-wire';
import { FallingSand } from './falling-sand';
import { FidgetSpinner } from './fidget-spinner';
import { FlappyBird } from './flappy-bird';
import { NewtonsCradle } from './newtons-cradle';
import { Pong } from './pong';
import { Simon } from './simon';
import { Snake } from './snake';
import { SpaceInvaders } from './space-invaders';
import { Suika } from './suika';
import { Tetris } from './tetris';
import { ThumbPiano } from './thumb-piano';
import { TowerOfHanoi } from './tower-of-hanoi';
import type { CanvasWidget } from './types';

/**
 * The one place a new widget gets wired in. Adding a widget is a new file plus one entry
 * here (and one id in main/widget-ids.ts).
 *
 * Order matters only in that it has to match `WIDGET_IDS` - the fidget toys, then the
 * games - which a test enforces. The cycle draws its own order at runtime.
 */
export const WIDGET_REGISTRY: Record<string, { label: string; create: () => CanvasWidget }> = {
  'bubble-wrap': { label: 'Bubble Wrap', create: () => new BubbleWrap() },
  'fidget-spinner': { label: 'Fidget Spinner', create: () => new FidgetSpinner() },
  'newtons-cradle': { label: "Newton's Cradle", create: () => new NewtonsCradle() },
  'falling-sand': { label: 'Falling Sand', create: () => new FallingSand() },
  'tower-of-hanoi': { label: 'Tower of Hanoi', create: () => new TowerOfHanoi() },
  'thumb-piano': { label: 'Thumb Piano', create: () => new ThumbPiano() },
  'buzz-wire': { label: 'Buzz Wire', create: () => new BuzzWire() },
  snake: { label: 'Snake', create: () => new Snake() },
  'flappy-bird': { label: 'Flappy Bird', create: () => new FlappyBird() },
  pong: { label: 'Pong', create: () => new Pong() },
  simon: { label: 'Simon', create: () => new Simon() },
  suika: { label: 'Suika', create: () => new Suika() },
  'space-invaders': { label: 'Space Invaders', create: () => new SpaceInvaders() },
  tetris: { label: 'Tetris', create: () => new Tetris() },
};

export function createWidget(id: string): CanvasWidget {
  const entry = WIDGET_REGISTRY[id] ?? WIDGET_REGISTRY['bubble-wrap']!;
  return entry.create();
}
