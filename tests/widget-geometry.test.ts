import { describe, expect, it, vi } from 'vitest';

import { BubbleWrap } from '../packages/app/src/renderer/widgets/bubble-wrap';
import { BuzzWire } from '../packages/app/src/renderer/widgets/buzz-wire';
import { FallingSand } from '../packages/app/src/renderer/widgets/falling-sand';
import { COLORWAYS, FidgetSpinner } from '../packages/app/src/renderer/widgets/fidget-spinner';
import { FlappyBird } from '../packages/app/src/renderer/widgets/flappy-bird';
import { NewtonsCradle } from '../packages/app/src/renderer/widgets/newtons-cradle';
import { Pong } from '../packages/app/src/renderer/widgets/pong';
import { Tetris } from '../packages/app/src/renderer/widgets/tetris';
import { ThumbPiano } from '../packages/app/src/renderer/widgets/thumb-piano';
import { TowerOfHanoi } from '../packages/app/src/renderer/widgets/tower-of-hanoi';
import { Simon } from '../packages/app/src/renderer/widgets/simon';
import { Snake } from '../packages/app/src/renderer/widgets/snake';
import { SpaceInvaders } from '../packages/app/src/renderer/widgets/space-invaders';
import { Suika } from '../packages/app/src/renderer/widgets/suika';
import {
  SCREEN_MARGIN,
  bottomClearance,
  defaultAnchor,
  placeWidget,
  widgetBounds,
} from '../packages/app/src/main/widget-ids';
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
    // Both the control point and the end point: a curve can bulge past its own endpoints,
    // and a probe that only saw where it landed would miss a widget bending out of frame.
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
      add(cx, cy);
      add(x, y);
    },
    arc: (x: number, y: number, r: number) => box(x - r, y - r, r * 2, r * 2),
    ellipse: (x: number, y: number, rx: number, ry: number) => box(x - rx, y - ry, rx * 2, ry * 2),
    fill: noop,
    stroke: noop,
    // The per-frame clear covers the whole box by definition, so it says nothing.
    clearRect: noop,
    // Neither does a clip: it is a region, not a mark, and counting its corners as drawn
    // points would let a widget widen its own bounding box by clipping.
    rect: noop,
    clip: noop,
    fillRect: box,
    fillText: (_t: string, x: number, y: number) => add(x, y),
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createConicGradient: () => gradient,
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
  ['falling-sand', () => new FallingSand()],
  ['tower-of-hanoi', () => new TowerOfHanoi()],
  ['thumb-piano', () => new ThumbPiano()],
  ['buzz-wire', () => new BuzzWire()],
  ['snake', () => new Snake()],
  ['flappy-bird', () => new FlappyBird()],
  ['pong', () => new Pong()],
  ['simon', () => new Simon()],
  ['suika', () => new Suika()],
  ['space-invaders', () => new SpaceInvaders()],
  ['tetris', () => new Tetris()],
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
 * Every colourway, not just whichever one the dice handed the sweep above.
 *
 * The rare finishes draw things the commons do not - a halo wider than the body, glints
 * hanging off the lobe tips - and at ~2% a pull they would otherwise be checked about
 * once every fifty runs, which is worse than not checking them at all.
 */
describe.each(COLORWAYS.map((c) => [c.id, c] as const))(
  'fidget-spinner %s geometry',
  (_id, skin) => {
    it('keeps its finish inside the window box', () => {
      const { points, width, height } = probe(
        'fidget-spinner',
        () => new FidgetSpinner(),
        240,
        (w) => {
          (w as unknown as { skin: typeof skin }).skin = skin;
        }
      );

      // Filtered rather than asserted per point: a probe run is six figures of points, and
      // an `expect` each would take longer than the whole rest of the suite.
      const bad = points.filter(
        ([x, y]) =>
          !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > width || y < 0 || y > height
      );
      expect(points.length).toBeGreaterThan(0);
      expect(bad.slice(0, 4)).toEqual([]);
    });
  }
);

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

/**
 * Where the window itself lands, as opposed to where a widget draws inside it.
 *
 * The two are separate failures: every test above can pass while the box is sitting off
 * the side of the screen, or on the wrong monitor.
 */
describe('window placement', () => {
  const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
  const square = widgetBounds('bubble-wrap');
  const wide = widgetBounds('newtons-cradle');

  it('puts a square toy exactly where it was parked', () => {
    expect(placeWidget({ x: 600, y: 400 }, square, PRIMARY)).toEqual({ x: 600, y: 400 });
  });

  // The saved anchor is the base square's corner, so a wider box has to grow around that
  // square's centre. Growing off its left edge would shift the toy sideways every time the
  // rotation happened to land on the cradle.
  it('grows a wide box around the square it replaces', () => {
    const spread = (wide.width - square.width) / 2;
    expect(placeWidget({ x: 600, y: 400 }, wide, PRIMARY)).toEqual({ x: 600 - spread, y: 400 });
  });

  // The default anchor sits a square's width from the right edge, so the cradle's extra
  // 120px has nowhere to go and the box must be pulled back in rather than hang off.
  it('pulls a wide box back inside the work area at the default corner', () => {
    const anchor = { x: PRIMARY.width - square.width - 24, y: PRIMARY.height - square.height - 80 };
    const { x } = placeWidget(anchor, wide, PRIMARY);
    expect(x).toBe(PRIMARY.width - wide.width);
    expect(x + wide.width).toBeLessThanOrEqual(PRIMARY.width);
  });

  // The regression this function was extracted for. A display left of the primary one has
  // a negative origin; clamping against the primary work area would snap x up to 0 and
  // haul the toy back onto the first monitor at the next swap.
  it('leaves a toy parked on a second monitor where it is', () => {
    const left = { x: -1920, y: -120, width: 1920, height: 1080 };
    expect(placeWidget({ x: -1800, y: 0 }, square, left)).toEqual({ x: -1800, y: 0 });
    expect(placeWidget({ x: -1800, y: 0 }, wide, left)).toEqual({ x: -1860, y: 0 });
  });

  it('clamps to the work area origin, not to zero', () => {
    const shifted = { x: 100, y: 60, width: 800, height: 600 };
    expect(placeWidget({ x: -50, y: -50 }, square, shifted)).toEqual({ x: 100, y: 60 });
  });
});

/**
 * The corner the toy starts in, on a desk nobody has dragged it around yet.
 *
 * Worth its own tests because it is the one piece of geometry that differs by platform,
 * and the difference is invisible to whoever wrote it: a Windows developer cannot see a
 * toy floating above the Dock, and a mac developer cannot see one swallowed by a taskbar.
 */
describe('default position', () => {
  const square = widgetBounds('bubble-wrap');
  const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };

  it('sits a margin in from the bottom-right of the work area', () => {
    const { x, y } = defaultAnchor(PRIMARY, 'darwin');
    expect(x).toBe(PRIMARY.width - square.width - SCREEN_MARGIN);
    expect(y).toBe(PRIMARY.height - square.height - SCREEN_MARGIN);
  });

  // An auto-hiding taskbar is not subtracted from workArea, so Windows - and only
  // Windows - buys clearance for a bar that may slide out over the corner.
  it('keeps clear of a Windows taskbar that workArea does not account for', () => {
    const win = defaultAnchor(PRIMARY, 'win32');
    const mac = defaultAnchor(PRIMARY, 'darwin');
    expect(mac.y - win.y).toBe(bottomClearance('win32'));
    expect(bottomClearance('win32')).toBeGreaterThan(0);
  });

  // The bug this was extracted to fix: macOS already insets workArea for the Dock and
  // the menu bar, so a Windows allowance on top of it parks the toy in mid-air.
  it('adds nothing below the toy on macOS or Linux, where workArea is already inset', () => {
    expect(bottomClearance('darwin')).toBe(0);
    expect(bottomClearance('linux')).toBe(0);
  });

  // A second monitor's work area has its own origin, and the default corner has to be
  // that display's corner rather than the primary one's.
  it('anchors to the given work area, not to the screen origin', () => {
    const left = { x: -1920, y: -120, width: 1920, height: 1080 };
    const { x, y } = defaultAnchor(left, 'darwin');
    expect(x).toBe(left.x + left.width - square.width - SCREEN_MARGIN);
    expect(y).toBe(left.y + left.height - square.height - SCREEN_MARGIN);
  });

  // Whatever the platform, the box the anchor describes has to fit on the display.
  it('leaves the toy fully on screen on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const anchor = defaultAnchor(PRIMARY, platform);
      const placed = placeWidget(anchor, square, PRIMARY);
      expect(placed).toEqual(anchor);
      expect(anchor.x + square.width).toBeLessThanOrEqual(PRIMARY.width);
      expect(anchor.y + square.height).toBeLessThanOrEqual(PRIMARY.height);
    }
  });
});
