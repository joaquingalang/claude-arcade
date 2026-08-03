import { describe, expect, it, vi } from 'vitest';

import { BubbleWrap } from '../packages/app/src/renderer/widgets/bubble-wrap';
import { FidgetSpinner } from '../packages/app/src/renderer/widgets/fidget-spinner';
import { FlappyBird } from '../packages/app/src/renderer/widgets/flappy-bird';
import { NewtonsCradle } from '../packages/app/src/renderer/widgets/newtons-cradle';
import { Pong } from '../packages/app/src/renderer/widgets/pong';
import { Snake } from '../packages/app/src/renderer/widgets/snake';
import { widgetBounds } from '../packages/app/src/main/widget-ids';
import type { CanvasWidget } from '../packages/app/src/renderer/widgets/types';

const SIZE = 280;

/**
 * Transform-aware context stub. The plain stub in widgets.test.ts proves a widget draws;
 * it cannot prove the drawing lands on screen. This one carries a matrix stack so every
 * point can be mapped to device space, which is the only way to tell a widget that is
 * rendering correctly from one that is rendering perfectly off the side of the box.
 */
type Mat = [number, number, number, number, number, number];

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function makeProbe(width: number, height: number) {
  const pts: Array<[number, number]> = [];
  let m: Mat = IDENTITY;
  const stack: Mat[] = [];

  const add = (x: number, y: number) => {
    pts.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  };
  const box = (x: number, y: number, w: number, h: number) => {
    add(x, y);
    add(x + w, y);
    add(x, y + h);
    add(x + w, y + h);
  };
  const noop = () => {};
  const gradient = { addColorStop: noop };

  const ctx = {
    points: pts,
    canvas: { width, height },
    save: () => {
      stack.push(m);
    },
    restore: () => {
      m = stack.pop() ?? IDENTITY;
    },
    translate: (x: number, y: number) => {
      m = mul(m, [1, 0, 0, 1, x, y]);
    },
    rotate: (r: number) => {
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    },
    scale: (x: number, y: number) => {
      m = mul(m, [x, 0, 0, y, 0, 0]);
    },
    beginPath: noop,
    closePath: noop,
    moveTo: add,
    lineTo: add,
    arc: (x: number, y: number, r: number) => box(x - r, y - r, r * 2, r * 2),
    ellipse: (x: number, y: number, rx: number, ry: number) => box(x - rx, y - ry, rx * 2, ry * 2),
    fill: noop,
    stroke: noop,
    // The per-frame clear covers the whole box by definition, so it says nothing.
    clearRect: noop,
    fillRect: box,
    fillText: (_t: string, x: number, y: number) => add(x, y),
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 0,
    lineCap: '' as unknown,
    globalCompositeOperation: '' as unknown,
    globalAlpha: 1,
    font: '' as unknown,
    textAlign: '' as unknown,
    textBaseline: '' as unknown,
    shadowColor: '' as unknown,
    shadowBlur: 0,
  };
  return ctx as unknown as CanvasRenderingContext2D & { points: Array<[number, number]> };
}

const WIDGETS: Array<[string, () => CanvasWidget]> = [
  ['bubble-wrap', () => new BubbleWrap()],
  ['fidget-spinner', () => new FidgetSpinner()],
  ['newtons-cradle', () => new NewtonsCradle()],
  ['snake', () => new Snake()],
  ['flappy-bird', () => new FlappyBird()],
  ['pong', () => new Pong()],
];

/**
 * Run a widget in its own window box and return every point it drew.
 *
 * The box comes from the main process's table rather than a constant here: the cradle
 * gets a wider window than the square toys, and probing it against a 280px box would
 * measure a layout the user never sees.
 */
function probe(
  id: string,
  make: () => CanvasWidget,
  frameCount = 400,
  before?: (w: CanvasWidget) => void
) {
  let now = 0;
  const frames: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(() => cb(now));
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('performance', { now: () => now });

  const { width, height } = widgetBounds(id);
  const ctx = makeProbe(width, height);
  const widget = make();
  widget.start(ctx, { width, height });
  before?.(widget);
  for (let i = 0; i < frameCount; i += 1) {
    now += 16;
    frames.shift()?.();
  }
  widget.stop();

  return { widget, ctx, points: ctx.points, width, height };
}

describe.each(WIDGETS)('%s geometry', (id, make) => {
  it('draws inside its own window box', () => {
    const { points, width, height } = probe(id, make);
    expect(points.length).toBeGreaterThan(0);

    const inside = points.filter(
      ([x, y]) => x >= -1 && x <= width + 1 && y >= -1 && y <= height + 1
    ).length;

    // Most of what a widget draws has to land on screen. A little overspill is legitimate
    // - a bubble clipped by the edge, say - so this is a sanity floor, not a clipping
    // check. A widget that regresses to drawing off the box drops to ~0.
    expect(inside / points.length).toBeGreaterThan(0.7);
  });
});

/**
 * The cradle gets a stricter rule than the sanity floor above.
 *
 * Its whole reason for having a wider window is that the swinging balls used to leave the
 * frame, so "mostly inside" is exactly the bug. Nothing it draws may leave the box, at
 * rest, mid-swing, or dragged to the stops.
 */
describe("Newton's cradle containment", () => {
  const bounds = widgetBounds('newtons-cradle');

  it('is wider than the default square', () => {
    expect(bounds.width).toBeGreaterThan(SIZE);
  });

  it('keeps every ball inside the box through a full run', () => {
    // Released from the widest angle the widget allows, not the gentler opening lift:
    // the worst case for the frame is a user who hauls a ball out to the stop.
    const { points, width, height } = probe(
      'newtons-cradle',
      () => new NewtonsCradle(),
      900,
      (w) => {
        const p = (w as unknown as { ballPos(i: number): { x: number; y: number } }).ballPos(0);
        w.onPointerDown(p.x, p.y);
        w.onPointerMove(-500, bounds.height / 2);
        w.onPointerUp(0, 0);
      }
    );
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(height);
    }
  });

  it('keeps the outer balls inside when dragged past the edge', () => {
    const { widget, ctx, width, height } = probe('newtons-cradle', () => new NewtonsCradle(), 5);
    ctx.points.length = 0;

    // Grab each outer ball and haul the pointer far outside the window on both sides.
    for (const ball of [0, 4]) {
      const balls = (widget as unknown as { balls: Array<{ angle: number }> }).balls;
      const pos = (widget as unknown as { ballPos(i: number): { x: number; y: number } }).ballPos(
        ball
      );
      widget.onPointerDown(pos.x, pos.y);
      for (const target of [-500, 500]) {
        widget.onPointerMove(target, height / 2);
        (widget as unknown as { draw(): void }).draw();
        expect(Math.abs(balls[ball]!.angle)).toBeLessThanOrEqual(Math.PI / 2);
      }
      widget.onPointerUp(0, 0);
    }

    for (const [x, y] of ctx.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(height);
    }
  });
});
