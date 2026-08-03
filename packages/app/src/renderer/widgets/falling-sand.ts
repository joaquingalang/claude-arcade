import { CanvasWidget } from './types';

const COLS = 56;
const ROWS = 56;
/** Sentinel for an empty cell. Every other value in the grid is a hue in degrees. */
const EMPTY = -1;

/**
 * Fixed simulation step, in seconds.
 *
 * Sand advanced once per frame would fall at whatever rate the display happens to run -
 * a 144Hz laptop would pour more than twice as fast as a 60Hz one. A grain moves exactly
 * one cell per step, so this number alone sets how fast sand falls.
 */
const STEP = 1 / 90;
/** Ceiling on the backlog a single frame may work off, so a stall can't freeze the toy. */
const MAX_STEPS = 4;

/** Grains per second from the stream that runs whether or not anyone is watching. */
const AMBIENT_RATE = 26;
/** Added on top of that while the pointer is held down. A pour should be visibly a pour. */
const POUR_RATE = 150;
/** Fraction of the grid that may hold sand before the floor opens. */
const FILL_LIMIT = 0.4;
const FILL_CAP = Math.round(COLS * ROWS * FILL_LIMIT);

/**
 * Degrees of hue per second.
 *
 * Every grain keeps the colour it was poured at, so this is what turns a heap into
 * strata: the mound records the order it was laid down in, the way real coloured sand
 * does. Slow enough that a whole appearance is one band of the spectrum.
 */
const HUE_DRIFT = 26;
/** Hues are snapped to this so neighbouring grains share a value and can be drawn as runs. */
const HUE_QUANTUM = 8;

/** Steps between floor sweeps while draining. Larger empties the box more slowly. */
const DRAIN_INTERVAL = 3;
/** Beat of empty box before the pour resumes, so the emptying reads as an event. */
const DRAIN_PAUSE = 0.45;
/** Height of the mound the toy opens with, in cells. */
const SEED_ROWS = 8;

type Phase = 'pouring' | 'draining';

/**
 * Falling sand.
 *
 * A cellular automaton, not a particle system: each cell holds a hue or nothing, and a
 * grain looks only at the three cells beneath it. That is what gives a real angle of
 * repose - mounds that hold their shape and avalanche when overloaded - for a fraction of
 * the cost of tracking a thousand positions and velocities.
 *
 * The box would eventually fill, and a full box is a still picture. So the toy breathes:
 * pour until the sand reaches its cap, open the floor and let the whole lot fall out, then
 * pour again. Bubble Wrap's sheet refills for the same reason.
 */
export class FallingSand extends CanvasWidget {
  private grid = new Int16Array(COLS * ROWS);
  private count = 0;
  private phase: Phase = 'pouring';
  private accum = 0;
  private time = 0;
  private hue = 0;
  private ambientAccum = 0;
  private pourAccum = 0;
  private drainTick = 0;
  private pauseTimer = 0;
  /**
   * Which way this step scans the rows.
   *
   * Flipped every step. A fixed scan order biases every avalanche the same way and the
   * pile visibly leans downwind of it.
   */
  private sweepRight = false;
  private pour: { c: number; r: number } | null = null;

  private cell = 0;
  private originX = 0;
  private originY = 0;

  protected init(): void {
    this.cell = this.size / COLS;
    this.originX = (this.width - this.size) / 2;
    this.originY = (this.height - this.size) / 2;

    this.grid.fill(EMPTY);
    this.count = 0;
    this.phase = 'pouring';
    this.accum = 0;
    this.time = 0;
    this.ambientAccum = 0;
    this.pourAccum = 0;
    this.drainTick = 0;
    this.pauseTimer = 0;
    this.pour = null;
    this.hue = Math.random() * 360;

    this.seed();
  }

  /**
   * Open on a shallow mound with the stream already in flight.
   *
   * The widget is rebuilt from scratch on every appearance, so without this it would fade
   * in as an empty box and the first grain would not reach the floor for a second and a
   * half. Same instinct as the cradle opening with a ball already lifted.
   */
  private seed(): void {
    const floor = ROWS - 1;
    for (let c = 0; c < COLS; c++) {
      const hump = Math.cos((c / (COLS - 1) - 0.5) * Math.PI * 1.6);
      const h = Math.max(1, Math.round(SEED_ROWS * (0.35 + 0.65 * Math.max(0, hump))));
      // Deeper sand is older sand, so the opening mound already carries the strata a live
      // pour would have laid down.
      for (let i = 0; i < h; i++) this.set(c, floor - i, this.hue - (h - i) * 3);
    }

    // A few grains strung down the stream's path, so it is mid-pour rather than about to
    // start pouring.
    for (let r = 3; r < ROWS - SEED_ROWS - 4; r += 3) {
      this.set(this.streamCol(-r * 0.012), r, this.hue);
    }
  }

  private set(c: number, r: number, hue: number): void {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    const i = r * COLS + c;
    if (this.grid[i] !== EMPTY) return;
    this.grid[i] = quantizeHue(hue);
    this.count++;
  }

  /** Where the ambient stream is falling from, in columns. */
  private streamCol(t: number): number {
    // Two sines of unrelated periods: the stream wanders across the box without ever
    // settling into a loop you can see coming.
    return Math.round(COLS / 2 + Math.sin(t * 0.55) * Math.sin(t * 0.21) * COLS * 0.34);
  }

  protected update(dt: number): void {
    // Clamping the accumulator rather than counting steps means a long stall is dropped
    // outright instead of being paid back over the following frames.
    this.accum = Math.min(this.accum + dt, STEP * MAX_STEPS);
    while (this.accum >= STEP) {
      this.accum -= STEP;
      this.step();
    }
  }

  private step(): void {
    this.time += STEP;
    this.hue = (this.hue + HUE_DRIFT * STEP) % 360;

    if (this.phase === 'pouring') this.emit();
    this.settle();
    if (this.phase === 'draining') this.drain();
    this.advancePhase();
  }

  private emit(): void {
    if (this.count >= FILL_CAP) return;

    this.ambientAccum += AMBIENT_RATE * STEP;
    while (this.ambientAccum >= 1) {
      this.ambientAccum -= 1;
      this.set(this.streamCol(this.time), 0, this.hue);
    }

    if (!this.pour) return;
    this.pourAccum += POUR_RATE * STEP;
    while (this.pourAccum >= 1) {
      this.pourAccum -= 1;
      // Spread across a few columns, or the pour is a one-cell-wide thread rather than a
      // handful of sand.
      const spread = Math.round((Math.random() - 0.5) * 4);
      this.set(this.pour.c + spread, this.pour.r, this.hue);
    }
  }

  /**
   * One pass of the automaton.
   *
   * Rows are walked bottom upwards so a grain that moves down lands in a row already
   * dealt with, which is what limits it to one cell per step. Walking top down instead
   * would let a whole column fall in a single pass and sand would drop instantly.
   */
  private settle(): void {
    this.sweepRight = !this.sweepRight;

    for (let r = ROWS - 2; r >= 0; r--) {
      for (let n = 0; n < COLS; n++) {
        const c = this.sweepRight ? n : COLS - 1 - n;
        const i = r * COLS + c;
        const hue = this.grid[i]!;
        if (hue === EMPTY) continue;

        const below = i + COLS;
        if (this.grid[below] === EMPTY) {
          this.grid[below] = hue;
          this.grid[i] = EMPTY;
          continue;
        }

        // Blocked underneath, so try to slide off the pile. Which diagonal is tried first
        // follows the sweep, for the same reason the sweep flips at all.
        const first = this.sweepRight ? 1 : -1;
        for (const d of [first, -first]) {
          const nc = c + d;
          if (nc < 0 || nc >= COLS) continue;
          // The cell alongside has to be free too. Without that check sand slips through
          // a one-cell-thick wall diagonally, and mounds leak from their own flanks.
          if (this.grid[i + d] !== EMPTY) continue;
          if (this.grid[below + d] !== EMPTY) continue;
          this.grid[below + d] = hue;
          this.grid[i] = EMPTY;
          break;
        }
      }
    }
  }

  /** Swallow the bottom row, letting the pile above collapse into it. */
  private drain(): void {
    this.drainTick++;
    if (this.drainTick % DRAIN_INTERVAL !== 0) return;

    const base = (ROWS - 1) * COLS;
    for (let c = 0; c < COLS; c++) {
      if (this.grid[base + c] === EMPTY) continue;
      this.grid[base + c] = EMPTY;
      this.count--;
    }
  }

  private advancePhase(): void {
    if (this.phase === 'pouring') {
      if (this.count >= FILL_CAP) {
        this.phase = 'draining';
        this.drainTick = 0;
      }
      return;
    }

    if (this.count > 0) return;
    this.pauseTimer += STEP;
    if (this.pauseTimer < DRAIN_PAUSE) return;
    this.pauseTimer = 0;
    this.phase = 'pouring';
  }

  protected draw(): void {
    this.drawFloor();

    const ctx = this.ctx;
    const cell = this.cell;
    for (let r = 0; r < ROWS; r++) {
      const row = r * COLS;
      let c = 0;
      while (c < COLS) {
        const hue = this.grid[row + c]!;
        if (hue === EMPTY) {
          c++;
          continue;
        }
        // Runs of one colour go out as a single rect. Hues are quantised on the way in
        // precisely so this merges - a settled pile is a few hundred rects, not a few
        // thousand.
        let end = c + 1;
        while (end < COLS && this.grid[row + end] === hue) end++;

        ctx.fillStyle = `hsl(${hue}, 74%, 62%)`;
        // Half a pixel of bleed: exact cells leave hairline gaps between neighbours once
        // the canvas is scaled by a fractional device pixel ratio.
        ctx.fillRect(
          this.originX + c * cell,
          this.originY + r * cell,
          (end - c) * cell + 0.5,
          cell + 0.5,
        );
        c = end;
      }
    }
  }

  /** The line the sand rests on, dimmed while it is open. */
  private drawFloor(): void {
    const ctx = this.ctx;
    const y = this.originY + this.size - 1;
    ctx.beginPath();
    ctx.moveTo(this.originX, y);
    ctx.lineTo(this.originX + this.size, y);
    ctx.strokeStyle =
      this.phase === 'draining' ? 'rgba(148,163,184,0.16)' : 'rgba(203,213,225,0.5)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private toCell(x: number, y: number): { c: number; r: number } {
    return {
      c: clamp(Math.floor((x - this.originX) / this.cell), 0, COLS - 1),
      r: clamp(Math.floor((y - this.originY) / this.cell), 0, ROWS - 1),
    };
  }

  override onPointerDown(x: number, y: number): void {
    this.pour = this.toCell(x, y);
  }

  /**
   * Only while the button is down.
   *
   * Bubble Wrap pops on a bare hover because popping is harmless, but a pointer crossing
   * the widget on its way somewhere else should not dump sand into it.
   */
  override onPointerMove(x: number, y: number): void {
    if (!this.pour) return;
    this.pour = this.toCell(x, y);
  }

  override onPointerUp(): void {
    this.pour = null;
  }
}

function quantizeHue(hue: number): number {
  const wrapped = ((hue % 360) + 360) % 360;
  return (Math.round(wrapped / HUE_QUANTUM) * HUE_QUANTUM) % 360;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
