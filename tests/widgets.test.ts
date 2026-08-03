import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BubbleWrap } from '../packages/app/src/renderer/widgets/bubble-wrap';
import { FidgetSpinner } from '../packages/app/src/renderer/widgets/fidget-spinner';
import { FlappyBird } from '../packages/app/src/renderer/widgets/flappy-bird';
import { NewtonsCradle } from '../packages/app/src/renderer/widgets/newtons-cradle';
import { Pong } from '../packages/app/src/renderer/widgets/pong';
import { Snake } from '../packages/app/src/renderer/widgets/snake';
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
    arc: rec('arc'),
    ellipse: rec('ellipse'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    clearRect: rec('clearRect'),
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

const widgets: Array<{ name: string; make: () => CanvasWidget }> = [
  { name: 'BubbleWrap', make: () => new BubbleWrap() },
  { name: 'FidgetSpinner', make: () => new FidgetSpinner() },
  { name: 'NewtonsCradle', make: () => new NewtonsCradle() },
  { name: 'Snake', make: () => new Snake() },
  { name: 'FlappyBird', make: () => new FlappyBird() },
  { name: 'Pong', make: () => new Pong() },
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
describe.each([
  { name: 'BubbleWrap', make: () => new BubbleWrap() },
  { name: 'FidgetSpinner', make: () => new FidgetSpinner() },
  { name: 'NewtonsCradle', make: () => new NewtonsCradle() },
])('$name is paced by the clock, not by itself', ({ make }) => {
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
