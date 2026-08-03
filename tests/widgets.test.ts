import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buzzer, pops } from '../packages/app/src/renderer/audio';
import { BubbleWrap } from '../packages/app/src/renderer/widgets/bubble-wrap';
import { FallingSand } from '../packages/app/src/renderer/widgets/falling-sand';
import {
  COLORWAYS,
  FidgetSpinner,
  rollColorway,
} from '../packages/app/src/renderer/widgets/fidget-spinner';
import { FlappyBird } from '../packages/app/src/renderer/widgets/flappy-bird';
import { NewtonsCradle } from '../packages/app/src/renderer/widgets/newtons-cradle';
import { Pong } from '../packages/app/src/renderer/widgets/pong';
import { RainStick } from '../packages/app/src/renderer/widgets/rain-stick';
import { Simon } from '../packages/app/src/renderer/widgets/simon';
import { Snake } from '../packages/app/src/renderer/widgets/snake';
import { SpaceInvaders } from '../packages/app/src/renderer/widgets/space-invaders';
import { Suika } from '../packages/app/src/renderer/widgets/suika';
import { ThumbPiano } from '../packages/app/src/renderer/widgets/thumb-piano';
import type { CanvasWidget } from '../packages/app/src/renderer/widgets/types';

const SIZE = 280;

/**
 * Minimal 2D context stub. Records calls so we can assert that a widget actually draws
 * something, and returns plausible objects where the real API returns objects.
 */
function makeCtx() {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(name);
      void args;
    };
  const gradient = { addColorStop: rec('addColorStop') };
  const ctx = {
    calls,
    canvas: { width: SIZE, height: SIZE },
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    scale: rec('scale'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    arc: rec('arc'),
    ellipse: rec('ellipse'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    clearRect: rec('clearRect'),
    rect: rec('rect'),
    clip: rec('clip'),
    fillRect: rec('fillRect'),
    fillText: rec('fillText'),
    measureText: () => {
      calls.push('measureText');
      return { width: 10 };
    },
    createRadialGradient: () => {
      calls.push('createRadialGradient');
      return gradient;
    },
    createLinearGradient: () => {
      calls.push('createLinearGradient');
      return gradient;
    },
    createConicGradient: () => {
      calls.push('createConicGradient');
      return gradient;
    },
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
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

/** Drive a widget's animation loop deterministically, without a real rAF. */
let rafQueue: FrameRequestCallback[] = [];
let clock = 0;

beforeEach(() => {
  rafQueue = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue = [];
  });
  vi.stubGlobal('performance', { now: () => clock });
});

function pump(frames: number, msPerFrame = 16) {
  for (let i = 0; i < frames; i++) {
    const cbs = rafQueue;
    rafQueue = [];
    clock += msPerFrame;
    for (const cb of cbs) cb(clock);
  }
}

const toys: Array<{ name: string; make: () => CanvasWidget }> = [
  { name: 'BubbleWrap', make: () => new BubbleWrap() },
  { name: 'FidgetSpinner', make: () => new FidgetSpinner() },
  { name: 'NewtonsCradle', make: () => new NewtonsCradle() },
  { name: 'FallingSand', make: () => new FallingSand() },
  { name: 'RainStick', make: () => new RainStick() },
  { name: 'ThumbPiano', make: () => new ThumbPiano() },
];

const widgets: Array<{ name: string; make: () => CanvasWidget }> = [
  ...toys,
  { name: 'Snake', make: () => new Snake() },
  { name: 'FlappyBird', make: () => new FlappyBird() },
  { name: 'Pong', make: () => new Pong() },
  { name: 'Simon', make: () => new Simon() },
  { name: 'Suika', make: () => new Suika() },
  { name: 'SpaceInvaders', make: () => new SpaceInvaders() },
];

describe.each(widgets)('$name', ({ make }) => {
  it('draws on every frame without throwing', () => {
    const ctx = makeCtx();
    const w = make();
    w.start(ctx, { width: SIZE, height: SIZE });
    expect(() => pump(30)).not.toThrow();
    expect(ctx.calls.length).toBeGreaterThan(0);
    expect(ctx.calls).toContain('clearRect');
    w.stop();
  });

  it('pause() actually stops the loop - no CPU burn while hidden', () => {
    const ctx = makeCtx();
    const w = make();
    w.start(ctx, { width: SIZE, height: SIZE });
    pump(5);
    const before = ctx.calls.length;

    w.pause();
    pump(20);
    expect(ctx.calls.length).toBe(before);

    w.resume();
    pump(5);
    expect(ctx.calls.length).toBeGreaterThan(before);
    w.stop();
  });

  it('resume() is idempotent - double resume must not double the frame rate', () => {
    const ctx = makeCtx();
    const w = make();
    w.start(ctx, { width: SIZE, height: SIZE });
    w.resume();
    w.resume();
    pump(3);
    // One loop means exactly one clearRect per frame.
    expect(ctx.calls.filter((c) => c === 'clearRect').length).toBe(3);
    w.stop();
  });

  it('survives pointer interaction anywhere in the box', () => {
    const ctx = makeCtx();
    const w = make() as CanvasWidget;
    w.start(ctx, { width: SIZE, height: SIZE });
    expect(() => {
      for (const [x, y] of [
        [0, 0],
        [SIZE / 2, SIZE / 2],
        [SIZE, SIZE],
        [-50, -50],
        [SIZE * 2, SIZE * 2],
      ]) {
        w.onPointerDown(x!, y!);
        w.onPointerMove(x! + 5, y! + 5);
        w.onPointerUp(x!, y!);
        pump(2);
      }
    }).not.toThrow();
    w.stop();
  });

  it('stays numerically stable over a long run', () => {
    const ctx = makeCtx();
    const w = make();
    w.start(ctx, { width: SIZE, height: SIZE });
    pump(600); // ~10 seconds
    expect(() => pump(10)).not.toThrow();
    w.stop();
  });
});

/**
 * The other half of the pacing rule.
 *
 * Games report when they are done and the cycle waits for them; the fidget toys have no
 * end and must never report, or the clock would stop being what moves them along.
 */
describe.each(toys)('$name is paced by the clock, not by itself', ({ make }) => {
  it('never reports done, however long it runs or is poked', () => {
    const ctx = makeCtx();
    const onDone = vi.fn();
    const w = make();
    w.start(ctx, { width: SIZE, height: SIZE, onDone });

    pump(1800); // ~30s, twice the default cycle
    for (let i = 0; i < 40; i++) {
      w.onPointerDown((i * 7) % SIZE, (i * 13) % SIZE);
      w.onPointerUp((i * 7) % SIZE, (i * 13) % SIZE);
      pump(3);
    }

    expect(onDone).not.toHaveBeenCalled();
    w.stop();
  });
});

describe('BubbleWrap', () => {
  it('pops a bubble under the pointer and refills once the sheet is empty', () => {
    const ctx = makeCtx();
    const w = new BubbleWrap();
    w.start(ctx, { width: SIZE, height: SIZE });

    const bubbles = () => (w as unknown as { bubbles: Array<{ popped: boolean }> }).bubbles;
    const total = bubbles().length;
    expect(total).toBeGreaterThan(0);
    expect(bubbles().every((b) => !b.popped)).toBe(true);

    // Pop every bubble by sweeping the whole box.
    for (let y = 0; y < SIZE; y += 4) {
      for (let x = 0; x < SIZE; x += 4) w.onPointerDown(x, y);
    }
    expect(bubbles().every((b) => b.popped)).toBe(true);

    // After the refill delay the sheet regenerates rather than staying empty.
    pump(120);
    expect(bubbles().some((b) => !b.popped)).toBe(true);
    w.stop();
  });

  it('asks for a pop sound once per bubble, and not for a miss', () => {
    const play = vi.spyOn(pops, 'play').mockImplementation(() => {});
    const ctx = makeCtx();
    const w = new BubbleWrap();
    w.start(ctx, { width: SIZE, height: SIZE });

    const bubbles = (w as unknown as { bubbles: Array<{ cx: number; cy: number }> }).bubbles;
    const first = bubbles[0]!;

    w.onPointerDown(first.cx, first.cy);
    expect(play).toHaveBeenCalledOnce();

    // The same bubble again is already flat - a dead bubble must not keep making noise.
    w.onPointerDown(first.cx, first.cy);
    expect(play).toHaveBeenCalledOnce();

    // The gap between bubbles is silent too.
    w.onPointerMove(0, 0);
    expect(play).toHaveBeenCalledOnce();

    w.stop();
    play.mockRestore();
  });
});

describe('FidgetSpinner', () => {
  it('spins down to rest through friction', () => {
    const ctx = makeCtx();
    const w = new FidgetSpinner();
    w.start(ctx, { width: SIZE, height: SIZE });
    const omega = () => (w as unknown as { omega: number }).omega;

    const initial = Math.abs(omega());
    expect(initial).toBeGreaterThan(0);
    pump(1200, 16); // ~19s
    expect(Math.abs(omega())).toBeLessThan(initial);
  });

  it('a drag imparts angular velocity', () => {
    const ctx = makeCtx();
    const w = new FidgetSpinner();
    w.start(ctx, { width: SIZE, height: SIZE });
    const omega = () => (w as unknown as { omega: number }).omega;

    w.onPointerDown(SIZE / 2, SIZE / 2 - 80);
    expect(omega()).toBe(0);
    w.onPointerMove(SIZE / 2 + 80, SIZE / 2);
    expect(Math.abs(omega())).toBeGreaterThan(0);
    w.onPointerUp(0, 0);
  });

  it('rolls a colourway on every opening', () => {
    const ctx = makeCtx();
    const w = new FidgetSpinner();
    const skin = () => (w as unknown as { skin: { id: string } }).skin;

    // The rare pull sits at the far end of the table, so a roll of ~1 lands on it and a
    // roll of 0 lands on the first common - proving the pick follows the dice at all.
    const rand = vi.spyOn(Math, 'random');

    rand.mockReturnValue(0);
    w.start(ctx, { width: SIZE, height: SIZE });
    expect(skin().id).toBe(COLORWAYS[0]!.id);
    w.stop();

    rand.mockReturnValue(0.9999);
    w.start(ctx, { width: SIZE, height: SIZE });
    expect(skin().id).toBe(COLORWAYS[COLORWAYS.length - 1]!.id);
    w.stop();

    rand.mockRestore();
  });
});

describe('rollColorway', () => {
  it('covers the whole table and never falls off either end', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(rollColorway(i / 2000).id);
    expect(seen.size).toBe(COLORWAYS.length);

    // Out-of-range and boundary rolls still have to return a real colourway; a spinner
    // that opens with `undefined` for a skin throws on its first frame.
    for (const roll of [0, 1, -0.5, 1.5, Number.NaN]) {
      expect(COLORWAYS).toContain(rollColorway(roll));
    }
  });

  it('keeps the special finishes rare', () => {
    let gold = 0;
    let prismatic = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const finish = rollColorway(i / N).finish;
      if (finish === 'gold') gold++;
      if (finish === 'prismatic') prismatic++;
    }
    // A sweep over the unit interval measures the table exactly, no sampling noise.
    expect(gold / N).toBeGreaterThan(0.03);
    expect(gold / N).toBeLessThan(0.12);
    expect(prismatic / N).toBeGreaterThan(0.005);
    expect(prismatic / N).toBeLessThan(0.035);
  });
});

describe.each(COLORWAYS.map((c) => [c.id, c] as const))('FidgetSpinner in %s', (_id, skin) => {
  it('draws without touching an unsupported context call', () => {
    const ctx = makeCtx();
    const w = new FidgetSpinner();
    w.start(ctx, { width: SIZE, height: SIZE });
    (w as unknown as { skin: typeof skin }).skin = skin;
    ctx.calls.length = 0;

    // Both at speed and at rest: the finishes scale their glow and glints off the blur,
    // and a divide-by-zero or a NaN colour only shows up at one end or the other.
    pump(30);
    (w as unknown as { omega: number }).omega = 0;
    pump(30);

    expect(ctx.calls).toContain('fill');
    w.stop();
  });
});

describe('NewtonsCradle', () => {
  it('conserves motion without exploding', () => {
    const ctx = makeCtx();
    const w = new NewtonsCradle();
    w.start(ctx, { width: SIZE, height: SIZE });
    const balls = () => (w as unknown as { balls: Array<{ angle: number; omega: number }> }).balls;

    pump(900); // ~15s of collisions
    for (const b of balls()) {
      expect(Number.isFinite(b.angle)).toBe(true);
      expect(Number.isFinite(b.omega)).toBe(true);
      // Angles must stay in a physical range; a broken solver runs away.
      expect(Math.abs(b.angle)).toBeLessThan(Math.PI);
      expect(Math.abs(b.omega)).toBeLessThan(50);
    }
  });

  it('transfers momentum from the lifted ball to the far side', () => {
    const ctx = makeCtx();
    const w = new NewtonsCradle();
    w.start(ctx, { width: SIZE, height: SIZE });
    const balls = () => (w as unknown as { balls: Array<{ angle: number; omega: number }> }).balls;

    // Starts with ball 0 lifted; the far ball should be moving at some point.
    let farMoved = false;
    for (let i = 0; i < 400; i++) {
      pump(1);
      if (Math.abs(balls()[4]!.omega) > 0.05) {
        farMoved = true;
        break;
      }
    }
    expect(farMoved).toBe(true);
  });
});

/** Kept in step with COLS in snake.ts; the module does not export it. */
const COLS_HINT = 13;

interface SnakeInternals {
  snake: Array<{ c: number; r: number }>;
  dir: { c: number; r: number };
  food: { c: number; r: number };
  target: { c: number; r: number } | null;
  mode: 'auto' | 'pointer' | 'keys';
  queue: Array<{ c: number; r: number }>;
  dying: boolean;
  lives: number;
  score: number;
  over: boolean;
  cell: number;
  originX: number;
  originY: number;
}

describe('Snake', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new Snake();
    const onDone = vi.fn();
    w.start(ctx, { width: SIZE, height: SIZE, onDone });
    return { w, onDone, st: w as unknown as SnakeInternals };
  };

  /** Canvas coordinates of the centre of a grid cell. */
  const at = (st: SnakeInternals, c: number, r: number) => ({
    x: st.originX + (c + 0.5) * st.cell,
    y: st.originY + (r + 0.5) * st.cell,
  });

  it('steers toward the pointer', () => {
    const { w, st } = start();
    expect(st.dir).toEqual({ c: 1, r: 0 });

    const head = st.snake[0]!;
    const p = at(st, head.c, head.r + 5);
    w.onPointerMove(p.x, p.y);
    pump(12); // longer than one step
    expect(st.dir).toEqual({ c: 0, r: 1 });
  });

  it('refuses to reverse into its own neck', () => {
    const { w, st } = start();
    const head = st.snake[0]!;
    // Point straight back down the body. A naive implementation turns around and dies
    // on the next step.
    const p = at(st, head.c - 5, head.r);
    w.onPointerMove(p.x, p.y);
    pump(30);
    expect(st.dir).toEqual({ c: 1, r: 0 });
    expect(st.dying).toBe(false);
  });

  it('wraps at the edges instead of dying against a wall', () => {
    const { w, st } = start();
    // Hold the pointer hard right so it runs off the edge repeatedly.
    const p = at(st, COLS_HINT - 1, st.snake[0]!.r);
    w.onPointerMove(p.x, p.y);
    pump(400);
    expect(st.dying).toBe(false);
    for (const s of st.snake) {
      expect(s.c).toBeGreaterThanOrEqual(0);
      expect(s.c).toBeLessThan(COLS_HINT);
      expect(Number.isInteger(s.c)).toBe(true);
    }
  });

  it('grows by one when it eats, and puts the food somewhere else', () => {
    const { st } = start();
    const head = st.snake[0]!;
    const before = st.snake.length;
    // Park the food directly in the snake's path.
    st.food = { c: head.c + 1, r: head.r };
    st.target = { c: head.c + 5, r: head.r };
    pump(12);
    expect(st.snake.length).toBe(before + 1);
    expect(st.food).not.toEqual({ c: head.c + 1, r: head.r });
  });

  it('resets itself after running into its own body', () => {
    const { st } = start();
    // A coil where stepping down lands on a segment that is not the tail.
    st.snake = [
      { c: 5, r: 5 },
      { c: 6, r: 5 },
      { c: 6, r: 6 },
      { c: 5, r: 6 },
      { c: 4, r: 6 },
    ];
    st.dir = { c: 1, r: 0 };
    st.target = { c: 5, r: 10 };
    st.food = { c: 0, r: 0 };

    pump(12);
    expect(st.dying).toBe(true);

    pump(60); // past the death fade
    expect(st.dying).toBe(false);
    expect(st.snake.length).toBe(4);
  });

  /** Steer into a coil that has no way out, then wait out the death fade. */
  const kill = (st: SnakeInternals) => {
    st.snake = [
      { c: 5, r: 5 },
      { c: 6, r: 5 },
      { c: 6, r: 6 },
      { c: 5, r: 6 },
      { c: 4, r: 6 },
    ];
    st.dir = { c: 1, r: 0 };
    st.mode = 'auto';
    st.target = { c: 5, r: 10 };
    st.food = { c: 0, r: 0 };
    pump(12);
    pump(60);
  };

  it('steers with the arrow keys', () => {
    const { w, st } = start();
    expect(st.dir).toEqual({ c: 1, r: 0 });

    w.onKey('Down');
    expect(st.mode).toBe('keys');
    pump(12); // longer than one step
    expect(st.dir).toEqual({ c: 0, r: 1 });
  });

  it('queues a second turn taken inside a single step', () => {
    const { w, st } = start();
    // Both presses land between two steps; a naive implementation keeps only the last and
    // the snake never makes the first turn.
    w.onKey('Down');
    w.onKey('Left');
    pump(12);
    expect(st.dir).toEqual({ c: 0, r: 1 });
    pump(12);
    expect(st.dir).toEqual({ c: -1, r: 0 });
  });

  it('refuses a key that reverses into its own neck', () => {
    const { w, st } = start();
    w.onKey('Left'); // heading right
    pump(12);
    expect(st.dir).toEqual({ c: 1, r: 0 });
    expect(st.dying).toBe(false);
  });

  it('caps the queue rather than banking a long run of presses', () => {
    const { w, st } = start();
    for (const key of ['Down', 'Left', 'Up', 'Right', 'Down'] as const) w.onKey(key);
    expect(st.queue.length).toBeLessThanOrEqual(2);
  });

  it('hands control back to the pointer, and back to the keys again', () => {
    const { w, st } = start();
    w.onKey('Down');
    expect(st.mode).toBe('keys');

    w.onPointerMove(SIZE / 2, SIZE / 2);
    expect(st.mode).toBe('pointer');
    // A queued key must not fire after the mouse has taken over.
    expect(st.queue).toHaveLength(0);

    w.onKey('Up');
    expect(st.mode).toBe('keys');
    expect(st.target).toBeNull();
  });

  it('plays itself until the first input', () => {
    const { w, st } = start();
    expect(st.mode).toBe('auto');
    pump(60);
    // Autopilot heads for the food rather than sitting still.
    expect(st.snake[0]).not.toEqual({ c: 6, r: 6 });
    w.onKey('Up');
    expect(st.mode).toBe('keys');
  });

  it('counts a meal toward the score', () => {
    const { st } = start();
    const head = st.snake[0]!;
    st.food = { c: head.c + 1, r: head.r };
    st.target = { c: head.c + 5, r: head.r };
    pump(12);
    expect(st.score).toBe(1);
  });

  it('spends three lives, then ends the run and hands over exactly once', () => {
    const { st, onDone } = start();
    expect(st.lives).toBe(3);

    kill(st);
    expect(st.lives).toBe(2);
    expect(st.over).toBe(false);
    kill(st);
    expect(st.lives).toBe(1);
    kill(st);

    expect(st.over).toBe(true);
    pump(150); // past the game-over pause
    expect(onDone).toHaveBeenCalledTimes(1);
    pump(120);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stops taking input once the run is over', () => {
    const { w, st } = start();
    st.lives = 1;
    kill(st);
    expect(st.over).toBe(true);

    w.onKey('Up');
    w.onPointerMove(SIZE / 2, SIZE / 2);
    expect(st.queue).toHaveLength(0);
    expect(st.mode).not.toBe('pointer');
  });
});

interface FlappyInternals {
  phase: 'ready' | 'playing' | 'dead' | 'over';
  birdY: number;
  vy: number;
  pipes: Array<{ x: number; gapY: number; scored: boolean }>;
  score: number;
  best: number;
  lives: number;
}

describe('FlappyBird', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new FlappyBird();
    const onDone = vi.fn();
    w.start(ctx, { width: SIZE, height: SIZE, onDone });
    return { w, onDone, st: w as unknown as FlappyInternals };
  };

  /** Fly into the ground and wait out whatever pause follows. */
  const crash = (st: FlappyInternals) => {
    st.birdY = SIZE * 0.95;
    pump(2);
  };

  it('waits in ready, bobbing, until the first click', () => {
    const { st } = start();
    pump(120); // 2 seconds of doing nothing
    expect(st.phase).toBe('ready');
    expect(st.pipes).toHaveLength(0);
    // Bobbing, not falling.
    expect(Math.abs(st.birdY - SIZE * 0.45)).toBeLessThan(SIZE * 0.04);
  });

  it('a click starts the game and lifts the bird', () => {
    const { w, st } = start();
    const before = st.birdY;
    w.onPointerDown(0, 0);
    expect(st.phase).toBe('playing');
    expect(st.vy).toBeLessThan(0);
    pump(4);
    expect(st.birdY).toBeLessThan(before);
  });

  it('gravity brings it down again without input', () => {
    const { w, st } = start();
    w.onPointerDown(0, 0);
    pump(60);
    expect(st.vy).toBeGreaterThan(0);
  });

  it('scores when a pipe passes the bird', () => {
    const { w, st } = start();
    w.onPointerDown(0, 0);
    const birdX = SIZE * 0.3;
    const pipeW = SIZE * 0.12;
    // A pipe already behind the bird, with the bird inside its gap.
    st.pipes = [{ x: birdX - pipeW - 1, gapY: st.birdY, scored: false }];
    pump(1);
    expect(st.score).toBe(1);
    expect(st.pipes[0]!.scored).toBe(true);
  });

  it('starts a run with three lives', () => {
    const { st } = start();
    expect(st.lives).toBe(3);
  });

  it('a crash costs one life and starts the next, carrying the score', () => {
    const { w, st, onDone } = start();
    w.onPointerDown(0, 0);
    st.score = 3;
    crash(st);
    expect(st.phase).toBe('dead');
    expect(st.lives).toBe(2);

    pump(90); // past the dead pause
    expect(st.phase).toBe('ready');
    expect(st.pipes).toHaveLength(0);
    // Three lives are one run, so the score carries. Resetting it would make them three
    // unrelated games that happen to share a widget.
    expect(st.score).toBe(3);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('spending the third life ends the run and hands over exactly once', () => {
    const { w, st, onDone } = start();

    for (let life = 3; life > 0; life--) {
      w.onPointerDown(0, 0);
      crash(st);
      expect(st.lives).toBe(life - 1);
      pump(90);
    }

    expect(st.phase).toBe('over');
    pump(150); // past the game-over pause
    expect(onDone).toHaveBeenCalledTimes(1);

    // Frames keep running until the swap lands; the report must not repeat.
    pump(120);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks while the run is over', () => {
    const { w, st } = start();
    st.lives = 1;
    w.onPointerDown(0, 0);
    crash(st);
    pump(90);
    expect(st.phase).toBe('over');

    w.onPointerDown(0, 0);
    expect(st.phase).toBe('over');
  });
});

interface PongInternals {
  ballX: number;
  ballY: number;
  ballVX: number;
  ballVY: number;
  speed: number;
  playerX: number;
  aiX: number;
  pointerX: number | null;
  serveTimer: number;
  playerScore: number;
  aiScore: number;
  winner: 'player' | 'ai' | null;
  readonly playerY: number;
}

describe('Pong', () => {
  const BALL_R = SIZE * 0.022;
  const start = () => {
    const ctx = makeCtx();
    const w = new Pong();
    const onDone = vi.fn();
    w.start(ctx, { width: SIZE, height: SIZE, onDone });
    return { w, onDone, st: w as unknown as PongInternals };
  };

  it('keeps the ball inside the side walls through a long rally', () => {
    const { st } = start();
    for (let i = 0; i < 600; i++) {
      pump(1);
      expect(st.ballX).toBeGreaterThanOrEqual(0);
      expect(st.ballX).toBeLessThanOrEqual(SIZE);
    }
  });

  it('plays itself until the pointer arrives', () => {
    const { w, st } = start();
    expect(st.pointerX).toBeNull();
    pump(30);
    w.onPointerMove(200, 0);
    expect(st.pointerX).toBe(200);
    pump(20);
    expect(Math.abs(st.playerX - 200)).toBeLessThan(4);
  });

  it('clamps the paddle to the court', () => {
    const { w, st } = start();
    w.onPointerMove(-500, 0);
    pump(30);
    expect(st.playerX).toBeGreaterThan(0);
    w.onPointerMove(SIZE + 500, 0);
    pump(30);
    expect(st.playerX).toBeLessThan(SIZE);
  });

  it('returns the ball off the paddle and speeds the rally up', () => {
    const { st } = start();
    st.serveTimer = 0;
    st.pointerX = st.playerX;
    st.ballX = st.playerX;
    st.ballY = st.playerY - BALL_R - 1;
    st.ballVX = 0;
    st.ballVY = 200;
    const speedBefore = st.speed;

    pump(3);
    expect(st.ballVY).toBeLessThan(0);
    expect(st.speed).toBeGreaterThan(speedBefore);
  });

  it('concedes a point when the ball goes past the paddle, then re-serves', () => {
    const { st } = start();
    st.serveTimer = 0;
    st.ballY = SIZE + BALL_R * 4;
    st.ballVY = 200;
    pump(1);

    expect(st.aiScore).toBe(1);
    expect(st.playerScore).toBe(0);
    expect(st.serveTimer).toBeGreaterThan(0);
    expect(st.ballY).toBeCloseTo(SIZE / 2, 0);
  });

  // A match that restarts every point at the opening pace is five slow rallies in a row
  // and outstays its welcome. The serve speed carries the escalation across points, so
  // the later ones are quicker than the first and the match winds itself up to an end.
  it('serves faster as the match goes on', () => {
    const { st } = start();
    const concede = () => {
      st.serveTimer = 0;
      st.ballY = SIZE + BALL_R * 4;
      st.ballVY = 200;
      pump(1);
    };

    const speeds = [st.speed];
    for (let point = 0; point < 3; point++) {
      concede();
      speeds.push(st.speed);
    }

    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    }
  });

  it('caps the ball speed however long the rally runs', () => {
    const { st } = start();
    st.serveTimer = 0;
    st.pointerX = st.playerX;

    // Put the ball on the player's paddle over and over: every hit adds a step, and
    // uncapped that would eventually tunnel it straight through a paddle in one frame.
    for (let i = 0; i < 40; i++) {
      st.ballX = st.playerX;
      st.ballY = st.playerY - BALL_R - 1;
      st.ballVX = 0;
      st.ballVY = 200;
      pump(2);
    }

    // Comfortably under a paddle-to-paddle traversal per 16ms frame.
    expect(st.speed).toBeLessThanOrEqual(SIZE * 1.35);
  });

  it('plays to the winning score instead of looping forever', () => {
    const { st, onDone } = start();
    st.serveTimer = 0;
    st.aiScore = 4;
    st.ballY = SIZE + BALL_R * 4;
    st.ballVY = 200;
    pump(1);

    // The match is decided and the score stands - it is the result, not a scratch value.
    expect(st.aiScore).toBe(5);
    expect(st.winner).toBe('ai');
    expect(onDone).not.toHaveBeenCalled();

    pump(150); // past the result pause
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('records the player as the winner when they get there first', () => {
    const { st } = start();
    st.serveTimer = 0;
    st.playerScore = 4;
    st.ballY = -BALL_R * 4;
    st.ballVY = -200;
    pump(1);
    expect(st.winner).toBe('player');
  });

  it('does not keep scoring after the match is over', () => {
    const { st } = start();
    st.serveTimer = 0;
    st.aiScore = 4;
    st.ballY = SIZE + BALL_R * 4;
    st.ballVY = 200;
    pump(1);
    pump(60);
    expect(st.aiScore).toBe(5);
    expect(st.playerScore).toBe(0);
  });
});

/** Kept in step with COLS/ROWS in falling-sand.ts; the module does not export them. */
const SAND_CELLS_HINT = 56 * 56;

interface SandInternals {
  count: number;
  phase: 'pouring' | 'draining';
  pour: { c: number; r: number } | null;
}

describe('FallingSand', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new FallingSand();
    w.start(ctx, { width: SIZE, height: SIZE });
    return { w, st: w as unknown as SandInternals };
  };

  it('opens with a mound already laid down', () => {
    const { st } = start();
    expect(st.count).toBeGreaterThan(0);
  });

  it('pours far faster under a held pointer than the ambient stream alone', () => {
    const idle = start();
    const idleBefore = idle.st.count;
    pump(30);
    const ambient = idle.st.count - idleBefore;
    idle.w.stop();

    const held = start();
    const heldBefore = held.st.count;
    held.w.onPointerDown(SIZE / 2, 6);
    pump(30);
    expect(held.st.count - heldBefore).toBeGreaterThan(ambient);
    held.w.stop();
  });

  it('stops pouring when the button comes up', () => {
    const { w, st } = start();
    w.onPointerDown(SIZE / 2, 6);
    expect(st.pour).not.toBeNull();
    w.onPointerUp(SIZE / 2, 6);
    expect(st.pour).toBeNull();
  });

  // The whole reason the toy has phases: a box that fills up is a still picture, and this
  // one has to be able to sit beside a terminal all day.
  it('opens the floor before the box can fill', () => {
    const { w, st } = start();
    w.onPointerDown(SIZE / 2, 6);

    let drained = false;
    for (let i = 0; i < 500; i++) {
      pump(1, 50);
      if (st.phase === 'draining') drained = true;
      expect(st.count).toBeLessThan(SAND_CELLS_HINT);
    }
    expect(drained).toBe(true);
    w.stop();
  });
});

/** Kept in step with the tube geometry in rain-stick.ts. */
const STICK_LEN_HINT = 0.74 * SIZE;
const STICK_HALF_W_HINT = (0.26 * SIZE) / 2;
const BEAD_R_HINT = 0.017 * SIZE;
const BEAD_COUNT_HINT = 44;

interface StickInternals {
  beads: Array<{ ax: number; ay: number; vx: number; vy: number }>;
  pegs: Array<{ ax: number; ay: number }>;
  angle: number;
  target: number;
  dragging: boolean;
  ticks: number;
}

describe('RainStick', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new RainStick();
    w.start(ctx, { width: SIZE, height: SIZE });
    return { w, st: w as unknown as StickInternals };
  };

  it('keeps every bead inside the tube, at any angle', () => {
    const { w, st } = start();
    // Haul it right round, which is the worst case for beads escaping an end.
    for (let turn = 0; turn < 8; turn++) {
      const a = (turn / 8) * Math.PI * 2;
      w.onPointerDown(SIZE / 2 + Math.sin(a) * 300, SIZE / 2 + Math.cos(a) * 300);
      pump(40);
    }
    for (const b of st.beads) {
      expect(Math.abs(b.ax)).toBeLessThanOrEqual(STICK_HALF_W_HINT - BEAD_R_HINT + 0.5);
      expect(b.ay).toBeGreaterThanOrEqual(BEAD_R_HINT - 0.5);
      expect(b.ay).toBeLessThanOrEqual(STICK_LEN_HINT - BEAD_R_HINT + 0.5);
    }
    expect(st.beads).toHaveLength(BEAD_COUNT_HINT);
    w.stop();
  });

  it('pours the beads to whichever end is downhill', () => {
    const { w, st } = start();

    // B end pointing down: beads should collect at high ay.
    w.onPointerDown(SIZE / 2, SIZE);
    pump(240);
    const low = st.beads.reduce((a, b) => a + b.ay, 0) / st.beads.length;

    // Now flip it over.
    w.onPointerDown(SIZE / 2, 0);
    pump(240);
    const high = st.beads.reduce((a, b) => a + b.ay, 0) / st.beads.length;

    expect(low).toBeGreaterThan(STICK_LEN_HINT * 0.5);
    expect(high).toBeLessThan(STICK_LEN_HINT * 0.5);
    w.stop();
  });

  /** Left alone it has to keep turning, or a settled stick is a still picture. */
  it('drifts on its own when nobody is holding it', () => {
    const { w, st } = start();
    const before = st.angle;
    pump(120);
    expect(st.angle).not.toBeCloseTo(before, 3);
    w.stop();
  });

  it('stops drifting while you are swinging it, and follows the pointer instead', () => {
    const { w, st } = start();
    w.onPointerDown(SIZE, SIZE / 2);
    pump(60);
    expect(st.dragging).toBe(true);
    // Pointer due right of centre means the low end should be pointing right: +pi/2.
    expect(st.angle).toBeCloseTo(Math.PI / 2, 1);
    w.stop();
  });

  /** A full cascade would otherwise ask for forty voices in one frame. */
  it('caps how many beads can be heard in a single frame', () => {
    const { w, st } = start();
    for (let i = 0; i < 30; i++) {
      w.onPointerDown(SIZE / 2, i % 2 === 0 ? 0 : SIZE);
      pump(4);
      expect(st.ticks).toBeLessThanOrEqual(4);
    }
    w.stop();
  });
});

/** Kept in step with the board geometry in thumb-piano.ts. */
const TINE_COUNT_HINT = 7;
const BRIDGE_Y_HINT = 0.36 * SIZE;
const TINE_SPACING_HINT = 0.098 * SIZE;
/** Which note each tine sounds, left to right - lowest in the middle, climbing outwards. */
const NOTE_OF_TINE_HINT = [6, 4, 2, 0, 1, 3, 5];

interface PianoInternals {
  tines: Array<{ ring: number; note: number; len: number }>;
  onTine: number;
}

describe('ThumbPiano', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new ThumbPiano();
    w.start(ctx, { width: SIZE, height: SIZE });
    return { w, st: w as unknown as PianoInternals };
  };

  /** Middle of tine `i`, a little below the bridge where it is free to move. */
  const on = (i: number) => ({
    x: SIZE / 2 + (i - (TINE_COUNT_HINT - 1) / 2) * TINE_SPACING_HINT,
    y: BRIDGE_Y_HINT + 0.1 * SIZE,
  });

  it('lays the notes out lowest in the middle, climbing outwards', () => {
    const { st } = start();
    expect(st.tines.map((t) => t.note)).toEqual(NOTE_OF_TINE_HINT);
    // Longest tine sounds the lowest note, which is what makes the V shape mean something.
    const longest = st.tines.indexOf(
      st.tines.reduce((a, b) => (a.len >= b.len ? a : b)),
    );
    expect(st.tines[longest]!.note).toBe(0);
  });

  it('plucks the tine under the pointer', () => {
    const { w, st } = start();
    const p = on(2);
    w.onPointerDown(p.x, p.y);
    expect(st.tines[2]!.ring).toBe(1);
    expect(st.tines.filter((t) => t.ring > 0)).toHaveLength(1);
    w.stop();
  });

  it('plucks nothing above the bridge, where the tines are clamped', () => {
    const { w, st } = start();
    const p = on(3);
    w.onPointerDown(p.x, BRIDGE_Y_HINT - 0.06 * SIZE);
    expect(st.tines.every((t) => t.ring === 0)).toBe(true);
    void p;
    w.stop();
  });

  /**
   * The point of the debounce: a sweep is a run of notes, and a pointer resting on one
   * tine is a single note however many frames it sits there.
   */
  it('sounds a swept tine once, not once per frame', () => {
    const { w, st } = start();
    const p = on(1);
    w.onPointerDown(p.x, p.y);
    st.tines[1]!.ring = 0.5; // as if it had been decaying a while
    for (let i = 0; i < 20; i++) {
      w.onPointerMove(p.x, p.y);
      pump(1);
    }
    // Re-plucking would have reset it to 1 rather than letting it fade.
    expect(st.tines[1]!.ring).toBeLessThan(0.5);
    w.stop();
  });

  /**
   * The press is what separates playing from passing through. A pointer crossing the
   * widget on its way somewhere else must not fire off a run of notes.
   */
  it('stays silent under a pointer that is not held down', () => {
    const { w, st } = start();
    for (let i = 0; i < TINE_COUNT_HINT; i++) {
      const p = on(i);
      w.onPointerMove(p.x, p.y);
    }
    expect(st.tines.every((t) => t.ring === 0)).toBe(true);
    w.stop();
  });

  it('stops sounding once the button is released', () => {
    const { w, st } = start();
    w.onPointerDown(on(0).x, on(0).y);
    w.onPointerUp(on(0).x, on(0).y);
    for (let i = 1; i < TINE_COUNT_HINT; i++) {
      const p = on(i);
      w.onPointerMove(p.x, p.y);
    }
    expect(st.tines.slice(1).every((t) => t.ring === 0)).toBe(true);
    w.stop();
  });

  it('sounds every tine a held sweep crosses', () => {
    const { w, st } = start();
    w.onPointerDown(on(0).x, on(0).y);
    for (let i = 1; i < TINE_COUNT_HINT; i++) {
      const p = on(i);
      w.onPointerMove(p.x, p.y);
    }
    expect(st.tines.every((t) => t.ring > 0)).toBe(true);
    w.stop();
  });

  it('lets go when the pointer leaves the tines', () => {
    const { w, st } = start();
    const p = on(4);
    w.onPointerDown(p.x, p.y);
    expect(st.onTine).toBe(4);
    w.onPointerMove(p.x, SIZE - 2);
    expect(st.onTine).toBe(-1);
    w.stop();
  });

  it('rings down to silence on its own', () => {
    const { w, st } = start();
    const p = on(3);
    w.onPointerDown(p.x, p.y);
    pump(120); // ~2s, past the ring time
    expect(st.tines[3]!.ring).toBe(0);
    w.stop();
  });
});

/** Kept in step with MAX_ROUNDS and the ring geometry in simon.ts. */
const SIMON_ROUNDS_HINT = 8;
const SIMON_RING_HINT = (0.15 + 0.42) / 2;

interface SimonInternals {
  sequence: number[];
  phase: 'idle' | 'showing' | 'input' | 'pause' | 'over';
  result: 'win' | 'loss' | null;
  step: number;
  score: number;
}

describe('Simon', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new Simon();
    const onDone = vi.fn();
    w.start(ctx, { width: SIZE, height: SIZE, onDone });
    return { w, onDone, st: w as unknown as SimonInternals };
  };

  /** The middle of a pad, in canvas coordinates. */
  const pad = (i: number) => {
    const r = SIMON_RING_HINT * SIZE;
    const a = Math.PI + i * (Math.PI / 2) + Math.PI / 4;
    return { x: SIZE / 2 + Math.cos(a) * r, y: SIZE / 2 + Math.sin(a) * r };
  };

  /** Run frames until the pads are accepting input. */
  const toInput = (st: SimonInternals) => {
    for (let i = 0; i < 400 && st.phase !== 'input'; i++) pump(1);
    expect(st.phase).toBe('input');
  };

  /** The press that starts a run, on the hub so it cannot be read as an answer. */
  const begin = (w: Simon) => w.onPointerDown(SIZE / 2, SIZE / 2);

  it('waits to be started rather than flashing at nobody', () => {
    const { st } = start();
    expect(st.phase).toBe('idle');
    expect(st.sequence).toHaveLength(0);

    pump(200); // ~3s of being ignored
    expect(st.phase).toBe('idle');
    expect(st.sequence).toHaveLength(0);
    expect(st.result).toBeNull();
  });

  /**
   * A game is exempt from the cycle clock, so a board waiting to be started has to give up
   * by itself. Handing over unstarted is not a loss - nobody played it.
   */
  it('hands over unstarted if nobody ever presses it', () => {
    const { onDone, st } = start();
    pump(1100); // ~17.6s, past the idle patience
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(st.result).toBeNull();
    expect(st.score).toBe(0);
  });

  it('starts on a press anywhere, wherever it lands', () => {
    const { w, st } = start();
    begin(w); // the hub: not on any pad
    expect(st.phase).toBe('showing');
    expect(st.sequence).toHaveLength(1);
    expect(st.result).toBeNull();
  });

  /** The starting press is the request for a sequence, not an answer to one. */
  it('does not count the starting press as an answer', () => {
    const { w, st } = start();
    const first = pad(0);
    w.onPointerDown(first.x, first.y);
    toInput(st);
    expect(st.step).toBe(0);
    expect(st.score).toBe(0);
    expect(st.result).toBeNull();
  });

  it('accepts a correct press and banks the round', () => {
    const { w, st } = start();
    begin(w);
    toInput(st);
    const p = pad(st.sequence[st.step]!);
    w.onPointerDown(p.x, p.y);
    expect(st.result).toBeNull();
    expect(st.score).toBe(1);
  });

  it('ends the run on a wrong press, and hands over exactly once', () => {
    const { w, onDone, st } = start();
    begin(w);
    toInput(st);
    const p = pad((st.sequence[st.step]! + 1) % 4);
    w.onPointerDown(p.x, p.y);

    expect(st.phase).toBe('over');
    expect(st.result).toBe('loss');
    expect(onDone).not.toHaveBeenCalled();

    pump(150); // past the result pause
    expect(onDone).toHaveBeenCalledTimes(1);
    pump(150);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  /**
   * A game is exempt from the cycle clock, so "waiting for a press that never comes" has
   * to be an ending. Without this the widget would sit there for the rest of the day.
   */
  it('calls the run if you walk away mid-sequence', () => {
    const { w, st } = start();
    begin(w);
    toInput(st);
    pump(400); // ~6.4s, comfortably past the patience window
    expect(st.phase).toBe('over');
    expect(st.result).toBe('loss');
  });

  it('ignores presses once the run is over', () => {
    const { w, st } = start();
    begin(w);
    toInput(st);
    const expected = st.sequence[st.step]!;
    const wrong = pad((expected + 1) % 4);
    w.onPointerDown(wrong.x, wrong.y);
    const length = st.sequence.length;

    const right = pad(expected);
    w.onPointerDown(right.x, right.y);
    expect(st.sequence).toHaveLength(length);
    expect(st.result).toBe('loss');
  });

  /**
   * The tone is a second copy of the colour, so every lit pad has to sound and the two
   * have to agree on which pad and for how long.
   */
  it('sounds each flash for as long as it is lit, and each press as it lands', () => {
    const play = vi.spyOn(buzzer, 'play').mockImplementation(() => {});
    const { w, st } = start();

    begin(w);
    expect(play).toHaveBeenCalledTimes(1);
    // The pad that is lit, for the length of the flash the timer was set to.
    expect(play.mock.calls[0]![0]).toBe(st.sequence[0]);
    expect(play.mock.calls[0]![1]).toBeGreaterThan(0.2);

    toInput(st);
    const before = play.mock.calls.length;
    const p = pad(st.sequence[0]!);
    w.onPointerDown(p.x, p.y);
    expect(play.mock.calls.length).toBe(before + 1);
    expect(play.mock.calls[before]![0]).toBe(st.sequence[0]);

    w.stop();
    play.mockRestore();
  });

  it('blats once on a wrong pad, and does not sound the pad that lost it', () => {
    const fail = vi.spyOn(buzzer, 'fail').mockImplementation(() => {});
    const play = vi.spyOn(buzzer, 'play').mockImplementation(() => {});
    const { w, st } = start();

    begin(w);
    toInput(st);
    const before = play.mock.calls.length;
    const wrong = pad((st.sequence[st.step]! + 1) % 4);
    w.onPointerDown(wrong.x, wrong.y);

    expect(fail).toHaveBeenCalledOnce();
    expect(play.mock.calls.length).toBe(before);

    w.stop();
    fail.mockRestore();
    play.mockRestore();
  });

  it('blats when a run times out, the same as a wrong pad', () => {
    const fail = vi.spyOn(buzzer, 'fail').mockImplementation(() => {});
    const { w, st } = start();

    begin(w);
    toInput(st);
    pump(400); // past the patience window
    expect(st.result).toBe('loss');
    expect(fail).toHaveBeenCalledOnce();

    w.stop();
    fail.mockRestore();
  });

  it('is winnable - eight rounds answered correctly, handed over once', () => {
    const win = vi.spyOn(buzzer, 'win').mockImplementation(() => {});
    const { w, onDone, st } = start();
    begin(w);
    for (let round = 0; round < SIMON_ROUNDS_HINT; round++) {
      toInput(st);
      for (const i of [...st.sequence]) {
        const p = pad(i);
        w.onPointerDown(p.x, p.y);
      }
    }
    expect(st.result).toBe('win');
    expect(st.score).toBe(SIMON_ROUNDS_HINT);
    expect(win).toHaveBeenCalledOnce();

    expect(onDone).not.toHaveBeenCalled();
    pump(150); // past the result pause
    expect(onDone).toHaveBeenCalledTimes(1);
    win.mockRestore();
  });
});

/** Kept in step with the jar geometry in suika.ts. */
const JAR_LEFT_HINT = 0.11 * SIZE;
const JAR_RIGHT_HINT = 0.89 * SIZE;
const JAR_FLOOR_HINT = 0.945 * SIZE;
const SUIKA_TOP_TIER_HINT = 4;
const SUIKA_RELOAD_HINT = 0.4;
const SUIKA_DROPS_HINT = 26;

interface SuikaFruit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tier: number;
  age: number;
}

interface SuikaInternals {
  fruit: SuikaFruit[];
  bursts: unknown[];
  score: number;
  next: number;
  reload: number;
  over: boolean;
  auto: boolean;
  remaining: number;
  radius(tier: number): number;
}

describe('Suika', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new Suika();
    const onDone = vi.fn();
    w.start(ctx, { width: SIZE, height: SIZE, onDone });
    return { w, onDone, st: w as unknown as SuikaInternals };
  };

  /** Drop a fruit of a chosen tier at a chosen x, bypassing the random deal. */
  const dropAt = (w: CanvasWidget, st: SuikaInternals, tier: number, x: number) => {
    st.next = tier;
    st.reload = 0;
    w.onPointerDown(x, 0);
  };

  it('plays itself until the pointer arrives, then stops', () => {
    const { w, st } = start();
    pump(120); // ~2s of autopilot
    expect(st.fruit.length).toBeGreaterThan(0);
    expect(st.auto).toBe(true);

    w.onPointerMove(SIZE / 2, SIZE / 2);
    expect(st.auto).toBe(false);
  });

  it('drops a fruit where you clicked and lets it fall to the floor', () => {
    const { w, st } = start();
    st.auto = false;
    st.fruit.length = 0;

    dropAt(w, st, 0, SIZE * 0.5);
    expect(st.fruit).toHaveLength(1);
    const f = st.fruit[0]!;
    expect(f.x).toBeCloseTo(SIZE * 0.5, 0);

    pump(180); // 3s - plenty to settle
    expect(f.y).toBeCloseTo(JAR_FLOOR_HINT - st.radius(f.tier), 0);
  });

  it('fuses two fruit of the same tier into one of the next', () => {
    const { w, st } = start();
    st.auto = false;
    st.fruit.length = 0;

    dropAt(w, st, 0, SIZE * 0.5);
    pump(120);
    dropAt(w, st, 0, SIZE * 0.5);
    pump(180);

    expect(st.fruit).toHaveLength(1);
    expect(st.fruit[0]!.tier).toBe(1);
    expect(st.score).toBeGreaterThan(0);
  });

  // Without a top of the ladder the jar can only ever fill, so a good run gets punished.
  it('annihilates two of the top tier instead of growing past it', () => {
    const { st } = start();
    st.auto = false;
    const r = st.radius(SUIKA_TOP_TIER_HINT);
    const y = JAR_FLOOR_HINT - r;
    st.fruit.length = 0;
    st.fruit.push(
      { x: SIZE / 2 - r * 0.6, y, vx: 0, vy: 0, tier: SUIKA_TOP_TIER_HINT, age: 5 },
      { x: SIZE / 2 + r * 0.6, y, vx: 0, vy: 0, tier: SUIKA_TOP_TIER_HINT, age: 5 },
    );

    pump(4);
    expect(st.fruit).toHaveLength(0);
    expect(st.score).toBeGreaterThan(0);
  });

  it('keeps every fruit inside the jar however hard it is loaded', () => {
    const { w, st } = start();
    st.auto = false;
    // Aim well outside the box on both sides, which the geometry test cannot do.
    for (let i = 0; i < 12; i++) {
      dropAt(w, st, i % 3, i % 2 === 0 ? -400 : SIZE * 3);
      pump(30);
    }
    for (const f of st.fruit) {
      const r = st.radius(f.tier);
      expect(f.x).toBeGreaterThanOrEqual(JAR_LEFT_HINT + r - 1);
      expect(f.x).toBeLessThanOrEqual(JAR_RIGHT_HINT - r + 1);
      expect(f.y).toBeLessThanOrEqual(JAR_FLOOR_HINT - r + 1);
    }
  });

  it('will not let a second fruit out until the reload has run', () => {
    const { w, st } = start();
    st.auto = false;
    st.fruit.length = 0;

    dropAt(w, st, 0, SIZE * 0.5);
    expect(st.fruit).toHaveLength(1);
    expect(st.reload).toBeCloseTo(SUIKA_RELOAD_HINT, 5);

    w.onPointerDown(SIZE * 0.5, 0); // same frame, second click
    expect(st.fruit).toHaveLength(1);
  });

  // A fruit is only over the line for as long as it takes to fall past it, so the run must
  // not end the instant one crosses.
  it('does not end on a fruit merely falling past the line', () => {
    const { w, st } = start();
    st.auto = false;
    st.fruit.length = 0;
    dropAt(w, st, 0, SIZE * 0.5);
    pump(120);
    expect(st.over).toBe(false);
  });

  it('ends once the jar has overflowed, and hands over exactly once', () => {
    const { st, onDone } = start();
    st.auto = false;
    // A column of settled fruit stacked well above the line.
    const r = st.radius(SUIKA_TOP_TIER_HINT);
    st.fruit.length = 0;
    for (let i = 0; i < 5; i++) {
      st.fruit.push({
        x: SIZE / 2,
        y: JAR_FLOOR_HINT - r - i * r * 2,
        vx: 0,
        vy: 0,
        // Alternating tiers, so the stack cannot merge itself back down out of trouble.
        tier: i % 2 === 0 ? SUIKA_TOP_TIER_HINT : SUIKA_TOP_TIER_HINT - 1,
        age: 5,
      });
    }

    pump(400, 30); // 12s: past the grace period and the result pause
    expect(st.over).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    pump(200, 30);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  /**
   * The invariant the basket exists for.
   *
   * Suika proper is endless-until-you-lose, and two melons annihilating means a jar played
   * even moderately well drains as fast as it fills. Before the basket, autopilot runs of
   * four simulated minutes ended in overflow exactly zero times out of twenty-five - a
   * self-paced widget that never reports done holds the window for the rest of the turn.
   */
  it('always ends, however well it is played', () => {
    const { onDone, st } = start();
    pump(4000, 30); // 2 simulated minutes of a jar that never overflows
    expect(st.over).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stops dealing once the basket is empty', () => {
    const { w, st } = start();
    st.auto = false;
    for (let i = 0; i < SUIKA_DROPS_HINT + 6; i++) {
      st.reload = 0;
      w.onPointerDown(SIZE * 0.5, 0);
    }
    // Merges only ever reduce the count, so this is an upper bound on what was dealt.
    expect(st.fruit.length).toBeLessThanOrEqual(SUIKA_DROPS_HINT);
    expect(st.remaining).toBe(0);
  });

  it('takes no more drops once the jar is full', () => {
    const { w, st } = start();
    st.auto = false;
    (st as unknown as { over: boolean }).over = true;
    const count = st.fruit.length;
    w.onPointerDown(SIZE * 0.5, 0);
    expect(st.fruit).toHaveLength(count);
  });
});

/** Kept in step with the fleet layout in space-invaders.ts. */
const INVADER_ROWS_HINT = 3;
const INVADER_COLS_HINT = 6;
const SHIP_Y_HINT = 0.88 * SIZE;

interface InvadersInternals {
  invaders: Array<{ col: number; row: number; alive: boolean }>;
  bullets: Array<{ x: number; y: number }>;
  bombs: Array<{ x: number; y: number }>;
  fleetX: number;
  fleetY: number;
  dir: number;
  wave: number;
  lives: number;
  score: number;
  shipX: number;
  pointerX: number | null;
  phase: 'playing' | 'dead' | 'clear' | 'over';
  result: 'win' | 'loss' | null;
}

describe('SpaceInvaders', () => {
  const start = () => {
    const ctx = makeCtx();
    const w = new SpaceInvaders();
    const onDone = vi.fn();
    w.start(ctx, { width: SIZE, height: SIZE, onDone });
    return { w, onDone, st: w as unknown as InvadersInternals };
  };

  /** Frames with the sky swept clear, so only the test decides when the ship is hit. */
  const wait = (st: InvadersInternals, frames: number) => {
    for (let i = 0; i < frames; i++) {
      st.bombs = [];
      pump(1);
    }
  };

  const bombTheShip = (st: InvadersInternals) => {
    st.bombs = [{ x: st.shipX, y: SHIP_Y_HINT }];
    pump(2);
  };

  it('opens with a full fleet', () => {
    const { st } = start();
    expect(st.invaders).toHaveLength(INVADER_ROWS_HINT * INVADER_COLS_HINT);
    expect(st.invaders.every((i) => i.alive)).toBe(true);
  });

  it('marches to the wall, turns, and drops a row', () => {
    const { st } = start();
    const startY = st.fleetY;
    const startDir = st.dir;

    let turned = false;
    for (let i = 0; i < 900 && !turned; i++) {
      pump(1);
      turned = st.dir !== startDir;
    }
    expect(turned).toBe(true);
    expect(st.fleetY).toBeGreaterThan(startY);
  });

  it('plays itself: the ship aims and fires without being touched', () => {
    const { st } = start();
    expect(st.pointerX).toBeNull();
    pump(600);
    expect(st.score).toBeGreaterThan(0);
  });

  it('hands steering over to the pointer', () => {
    const { w, st } = start();
    w.onPointerMove(60, 0);
    expect(st.pointerX).toBe(60);
    pump(40);
    expect(Math.abs(st.shipX - 60)).toBeLessThan(6);
  });

  it('clears a wave, brings the next one in, and wins on the last', () => {
    const { onDone, st } = start();

    for (const inv of st.invaders) inv.alive = false;
    pump(2);
    expect(st.phase).toBe('clear');

    wait(st, 120); // past the pause between waves
    expect(st.wave).toBe(2);
    expect(st.invaders.every((i) => i.alive)).toBe(true);

    for (const inv of st.invaders) inv.alive = false;
    pump(2);
    expect(st.result).toBe('win');
    expect(onDone).not.toHaveBeenCalled();

    pump(150); // past the result pause
    expect(onDone).toHaveBeenCalledTimes(1);
    pump(150);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('spends three lives, then ends the run and hands over exactly once', () => {
    const { onDone, st } = start();
    expect(st.lives).toBe(3);

    bombTheShip(st);
    expect(st.lives).toBe(2);
    expect(st.phase).toBe('dead');
    wait(st, 80); // past the pause after a lost life
    expect(st.phase).toBe('playing');

    bombTheShip(st);
    expect(st.lives).toBe(1);
    wait(st, 80);

    bombTheShip(st);
    expect(st.lives).toBe(0);
    expect(st.result).toBe('loss');

    pump(150); // past the result pause
    expect(onDone).toHaveBeenCalledTimes(1);
    pump(150);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // Spending a life on a landed fleet would just replay the same frame: there is nowhere
  // left to stand, so it takes the whole run at once.
  it('ends outright when the fleet reaches the ship, whatever lives are left', () => {
    const { st } = start();
    st.fleetY = SHIP_Y_HINT;
    pump(2);
    expect(st.lives).toBe(0);
    expect(st.result).toBe('loss');
  });
});
