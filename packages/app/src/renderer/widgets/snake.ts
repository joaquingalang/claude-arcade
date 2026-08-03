import { CanvasWidget, type ArrowKey } from './types';

const COLS = 13;
const ROWS = 13;
const PAD = 0.06;
const START_LEN = 4;
/** Lives in a run. Spend them all and the widget hands over to the next toy. */
const LIVES = 3;
/** How long the final score is held before handing over. */
const OVER_PAUSE = 1.6;
/** Queued turns. Two is enough for a deliberate round-the-corner; more feels ghost-driven. */
const MAX_QUEUED = 2;

/** Seconds per cell. Each meal shaves a little off, down to the floor. */
const STEP_START = 0.14;
const STEP_MIN = 0.08;
const STEP_DECAY = 0.004;
const DEATH_FADE = 0.6;

interface Cell {
  c: number;
  r: number;
}

/** Screen directions: r grows downward, so Up is -1. */
const KEY_DIRS: Record<ArrowKey, Cell> = {
  Up: { c: 0, r: -1 },
  Down: { c: 0, r: 1 },
  Left: { c: -1, r: 0 },
  Right: { c: 1, r: 0 },
};

/**
 * Shortest signed distance from `a` to `b` on a ring of `n` - the edges wrap, so going
 * left off column 0 is one step, not twelve.
 */
function wrapDelta(a: number, b: number, n: number): number {
  let d = b - a;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

function wrap(v: number, n: number): number {
  return ((v % n) + n) % n;
}

/**
 * How the snake is being driven right now.
 *
 * Whichever input was used last wins, and it starts on autopilot so the toy is already
 * moving when it fades in rather than waiting to be noticed.
 */
type Mode = 'auto' | 'pointer' | 'keys';

/**
 * Snake, steered by the arrow keys.
 *
 * Arrows are the real game, and the widget window is `focusable: false`, so the keys are
 * grabbed globally by the main process and forwarded in - see `main/keyboard.ts` for the
 * cost of that and the setting that turns it off. Pointer steering is still here and
 * still works; the last input used is the one in charge, so turning the key grab off
 * leaves a fully playable toy rather than a broken one.
 *
 * Turns are queued rather than applied instantly. Pressing up-then-left inside one step
 * would otherwise throw the first press away, which is exactly the input that feels
 * stolen in a game about corners.
 *
 * Two deliberate softenings, both because this is a toy and not a game:
 *
 * - **Walls wrap.** Self-collision is the only way to die. It keeps the autopilot from
 *   looking suicidal when nobody is playing, and stops a key held a beat too long from
 *   ending a run against an edge you cannot see.
 * - **It plays itself.** Until the first input it steers toward the food.
 *
 * A run is three lives. The third death ends it and hands over to the next toy, which is
 * what keeps a game nobody is playing from owning the screen for a whole long turn.
 */
export class Snake extends CanvasWidget {
  private snake: Cell[] = [];
  private dir: Cell = { c: 1, r: 0 };
  private food: Cell = { c: 0, r: 0 };
  private target: Cell | null = null;
  private mode: Mode = 'auto';
  /** Turns waiting to be applied, oldest first. */
  private queue: Cell[] = [];
  private stepTimer = 0;
  private stepInterval = STEP_START;
  private dying = false;
  /** 0 -> 1 across the death fade, after which the board resets. */
  private deadT = 0;
  private pulse = 0;
  private lives = LIVES;
  private score = 0;
  private best = 0;
  private over = false;
  private overTimer = 0;

  private cell = 0;
  private originX = 0;
  private originY = 0;

  protected init(): void {
    const pad = this.size * PAD;
    this.cell = (this.size - pad * 2) / COLS;
    this.originX = pad;
    this.originY = pad + ((COLS - ROWS) * this.cell) / 2;
    this.lives = LIVES;
    this.best = 0;
    this.over = false;
    this.overTimer = 0;
    this.reset();
  }

  /** Start a life. Lives and best survive; the board and the current score do not. */
  private reset(): void {
    const r = Math.floor(ROWS / 2);
    const c = Math.floor(COLS / 2);
    this.snake = Array.from({ length: START_LEN }, (_, i) => ({ c: c - i, r }));
    this.dir = { c: 1, r: 0 };
    this.stepTimer = 0;
    this.stepInterval = STEP_START;
    this.dying = false;
    this.deadT = 0;
    this.target = null;
    this.queue = [];
    this.score = 0;
    // Back to autopilot between lives: the next life should be moving before you re-engage,
    // and a stale pointer target from the last one would send it somewhere arbitrary.
    this.mode = 'auto';
    this.spawnFood();
  }

  private spawnFood(): void {
    const taken = new Set(this.snake.map((s) => `${s.c},${s.r}`));
    const free: Cell[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!taken.has(`${c},${r}`)) free.push({ c, r });
      }
    }
    // A snake that fills the board has nowhere to put food; leave the old one be.
    if (free.length === 0) return;
    this.food = free[Math.floor(Math.random() * free.length)]!;
  }

  protected update(dt: number): void {
    this.pulse += dt;

    if (this.over) {
      this.overTimer += dt;
      if (this.overTimer >= OVER_PAUSE) this.finish();
      return;
    }

    if (this.dying) {
      this.deadT += dt / DEATH_FADE;
      if (this.deadT < 1) return;
      // Out of lives: hold the final board instead of resetting into a fourth life.
      if (this.lives <= 0) {
        this.over = true;
        this.overTimer = 0;
        return;
      }
      this.reset();
      return;
    }

    this.stepTimer += dt;
    while (this.stepTimer >= this.stepInterval && !this.dying) {
      this.stepTimer -= this.stepInterval;
      this.step();
    }
  }

  private step(): void {
    this.dir = this.chooseDir();
    const head = this.snake[0]!;
    const next: Cell = {
      c: wrap(head.c + this.dir.c, COLS),
      r: wrap(head.r + this.dir.r, ROWS),
    };

    const eating = next.c === this.food.c && next.r === this.food.r;
    // The tail vacates its cell on this same step, so it is not an obstacle - unless the
    // snake is growing and the tail stays put.
    const body = eating ? this.snake : this.snake.slice(0, -1);
    if (body.some((s) => s.c === next.c && s.r === next.r)) {
      this.dying = true;
      this.deadT = 0;
      this.lives--;
      return;
    }

    this.snake.unshift(next);
    if (eating) {
      this.score++;
      this.best = Math.max(this.best, this.score);
      this.stepInterval = Math.max(STEP_MIN, this.stepInterval - STEP_DECAY);
      this.spawnFood();
    } else {
      this.snake.pop();
    }
  }

  /** A turn that would double back into the neck kills instantly - always refuse it. */
  private isReverse(d: Cell): boolean {
    return d.c === -this.dir.c && d.r === -this.dir.r;
  }

  /**
   * Turn toward the target on whichever axis it is further away, but never straight back
   * into the neck - a 180 would be an instant self-collision and would read as the toy
   * killing itself for no reason.
   *
   * Under keyboard control the queue replaces all of that: an explicit press is an
   * instruction, not a hint, so nothing second-guesses it.
   */
  private chooseDir(): Cell {
    if (this.mode === 'keys') {
      // Drop reversals rather than stalling on them - the press was almost certainly
      // meant for a corner that has already been turned.
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        if (!this.isReverse(next)) return next;
      }
      return this.dir;
    }

    const head = this.snake[0]!;
    const target = this.target ?? this.food;
    const dc = wrapDelta(head.c, target.c, COLS);
    const dr = wrapDelta(head.r, target.r, ROWS);

    const horizontal: Cell = { c: Math.sign(dc), r: 0 };
    const vertical: Cell = { c: 0, r: Math.sign(dr) };
    const [first, second] =
      Math.abs(dc) >= Math.abs(dr) ? [horizontal, vertical] : [vertical, horizontal];

    for (const candidate of [first, second]) {
      if (candidate.c === 0 && candidate.r === 0) continue;
      if (this.isReverse(candidate)) continue;
      return candidate;
    }
    return this.dir;
  }

  private cellX(c: number): number {
    return this.originX + (c + 0.5) * this.cell;
  }

  private cellY(r: number): number {
    return this.originY + (r + 0.5) * this.cell;
  }

  protected draw(): void {
    const ctx = this.ctx;
    ctx.save();
    // Fade the whole board out on death, then it comes straight back.
    if (this.dying) ctx.globalAlpha = Math.max(0, 1 - this.deadT);

    this.drawBoard();
    this.drawFood();
    this.drawSnake();

    ctx.restore();

    // HUD stays at full opacity through the death fade - it is the one thing you want to
    // read at exactly that moment.
    this.drawHud();
    if (this.over) this.drawGameOver();
  }

  private drawHud(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 5;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.font = `600 ${Math.round(this.size * 0.055)}px system-ui, sans-serif`;
    ctx.fillText(String(this.score), this.originX, this.size * 0.012);

    // One pip per life left, opposite the score.
    const r = this.size * 0.016;
    const gap = r * 3;
    const right = this.originX + COLS * this.cell;
    for (let i = 0; i < LIVES; i++) {
      ctx.beginPath();
      ctx.arc(right - r - i * gap, this.size * 0.04, r, 0, Math.PI * 2);
      ctx.fillStyle = i < this.lives ? 'rgba(134,239,172,0.95)' : 'rgba(148,163,184,0.3)';
      ctx.fill();
    }
    ctx.restore();
  }

  private drawGameOver(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 ${Math.round(this.size * 0.07)}px system-ui, sans-serif`;
    ctx.fillText(`best ${this.best}`, this.size / 2, this.size / 2);
    ctx.restore();
  }

  private drawBoard(): void {
    const ctx = this.ctx;
    const w = COLS * this.cell;
    const h = ROWS * this.cell;
    ctx.fillStyle = 'rgba(15,23,42,0.28)';
    ctx.fillRect(this.originX, this.originY, w, h);
    ctx.strokeStyle = 'rgba(148,163,184,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.originX, this.originY);
    ctx.lineTo(this.originX + w, this.originY);
    ctx.lineTo(this.originX + w, this.originY + h);
    ctx.lineTo(this.originX, this.originY + h);
    ctx.closePath();
    ctx.stroke();
  }

  private drawFood(): void {
    const ctx = this.ctx;
    const x = this.cellX(this.food.c);
    const y = this.cellY(this.food.r);
    const beat = 1 + Math.sin(this.pulse * 5) * 0.12;
    const r = this.cell * 0.32 * beat;

    ctx.beginPath();
    ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(248,113,113,0.16)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f87171';
    ctx.fill();
  }

  private drawSnake(): void {
    const ctx = this.ctx;
    const r = this.cell * 0.4;

    for (let i = this.snake.length - 1; i >= 0; i--) {
      const s = this.snake[i]!;
      const t = 1 - i / Math.max(1, this.snake.length);
      const x = this.cellX(s.c);
      const y = this.cellY(s.r);

      ctx.fillStyle = `rgba(${Math.round(74 + t * 60)},${Math.round(190 + t * 40)},${Math.round(130 + t * 40)},${0.55 + t * 0.45})`;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // Bridge to the segment ahead so the body reads as one creature. Skipped across a
      // wrap, where the two segments are on opposite edges and a bridge would streak
      // across the whole board.
      const ahead = this.snake[i - 1];
      if (!ahead) continue;
      const dc = ahead.c - s.c;
      const dr = ahead.r - s.r;
      if (Math.abs(dc) > 1 || Math.abs(dr) > 1) continue;
      const ax = this.cellX(ahead.c);
      const ay = this.cellY(ahead.r);
      ctx.fillRect(Math.min(x, ax) - r, Math.min(y, ay) - r, Math.abs(ax - x) + r * 2, Math.abs(ay - y) + r * 2);
    }

    this.drawEyes();
  }

  private drawEyes(): void {
    const ctx = this.ctx;
    const head = this.snake[0]!;
    const x = this.cellX(head.c);
    const y = this.cellY(head.r);
    const off = this.cell * 0.17;
    // Eyes sit either side of the direction of travel.
    const px = -this.dir.r;
    const py = this.dir.c;

    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        x + px * off * sign + this.dir.c * off * 0.5,
        y + py * off * sign + this.dir.r * off * 0.5,
        this.cell * 0.1,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = '#0f172a';
      ctx.fill();
    }
  }

  private toCell(x: number, y: number): Cell {
    return {
      c: Math.max(0, Math.min(COLS - 1, Math.floor((x - this.originX) / this.cell))),
      r: Math.max(0, Math.min(ROWS - 1, Math.floor((y - this.originY) / this.cell))),
    };
  }

  override onPointerDown(x: number, y: number): void {
    this.steerTo(x, y);
  }

  /** Hovering steers too - holding a button down to drive would be needless friction. */
  override onPointerMove(x: number, y: number): void {
    this.steerTo(x, y);
  }

  private steerTo(x: number, y: number): void {
    if (this.over) return;
    this.target = this.toCell(x, y);
    // Taking the mouse back overrides the keys, and vice versa. Whichever hand you moved
    // last is the one driving.
    this.mode = 'pointer';
    this.queue = [];
  }

  /**
   * An arrow key, forwarded from the main process's global accelerator.
   *
   * Queued against the current *last queued* direction rather than the current heading, so
   * two presses inside one step both land - up-then-left round a corner is one gesture,
   * not a race against the step timer.
   */
  override onKey(key: ArrowKey): void {
    if (this.over) return;
    const dir = KEY_DIRS[key];

    // Taking the keyboard is itself the input. Pressing the way the autopilot already
    // happens to be heading still means "I am driving now", so this comes before any
    // decision about whether the press changes the heading.
    this.mode = 'keys';
    this.target = null;

    const last = this.queue[this.queue.length - 1] ?? this.dir;
    // Drop a press that changes nothing, or that doubles back on what is already queued.
    if (dir.c === last.c && dir.r === last.r) return;
    if (dir.c === -last.c && dir.r === -last.r) return;

    if (this.queue.length >= MAX_QUEUED) this.queue.shift();
    this.queue.push(dir);
  }
}
