import { BubbleWrap } from './bubble-wrap';
import { FidgetSpinner } from './fidget-spinner';
import { FlappyBird } from './flappy-bird';
import { NewtonsCradle } from './newtons-cradle';
import { Pong } from './pong';
import { Snake } from './snake';
import type { CanvasWidget } from './types';

/**
 * The one place a new widget gets wired in. Adding a widget is a new file plus one entry
 * here (and one id in main/widget-ids.ts).
 *
 * Order matters only in that it has to match `WIDGET_IDS` - the three fidget toys, then
 * the three games - which a test enforces. The cycle draws its own order at runtime.
 */
export const WIDGET_REGISTRY: Record<string, { label: string; create: () => CanvasWidget }> = {
  'bubble-wrap': { label: 'Bubble Wrap', create: () => new BubbleWrap() },
  'fidget-spinner': { label: 'Fidget Spinner', create: () => new FidgetSpinner() },
  'newtons-cradle': { label: "Newton's Cradle", create: () => new NewtonsCradle() },
  snake: { label: 'Snake', create: () => new Snake() },
  'flappy-bird': { label: 'Flappy Bird', create: () => new FlappyBird() },
  pong: { label: 'Pong', create: () => new Pong() },
};

export function createWidget(id: string): CanvasWidget {
  const entry = WIDGET_REGISTRY[id] ?? WIDGET_REGISTRY['bubble-wrap']!;
  return entry.create();
}
