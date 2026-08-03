import { CanvasWidget } from './types';

/** Four pads, arranged as quadrants of a ring. More would be unreadable at 280px. */
const PADS = 4;

/** Sequence length that wins the run. Eight is about twenty seconds of play. */
const MAX_ROUNDS = 8;

/**
 * How long a pad stays lit during playback, in seconds, for the first step of a run,
 * shortened by `FLASH_RAMP` for every step already in the sequence.
 *
 * Real Simon speeds up as the sequence grows, and it has to: a run of eight played at the
 * opening pace is nearly six seconds of watching before you are allowed to touch anything.
 */
const FLASH = 0.44;
const FLASH_RAMP = 0.028;
const FLASH_MIN = 0.24;

/**
 * Dark beat between two flashes, as a fraction of the flash itself.
 *
 * Without it the same pad twice in a row is indistinguishable from one long flash, which
 * is the one thing a memory game cannot afford to be ambiguous about.
 */
const GAP_RATIO = 0.34;

/** Beat between a completed round and the next playback. */
const ROUND_PAUSE = 0.6;

/**
 * Seconds allowed between presses before the run is called.
 *
 * A game is exempt from the cycle clock and hands over only when it decides it is
 * finished, so "waiting for a press that never comes" has to be an ending rather than a
 * state it can sit in. Generous enough that thinking about it is not a loss.
 */
const PATIENCE = 4;

/** How long the result is held before handing over, so the run has an ending. */
const OVER_PAUSE = 1.7;

/** Seconds between the autopilot's presses while nobody has touched it. */
const AUTO_PRESS = 0.32;

/** How fast a pad's glow falls away once it is no longer held lit. */
const GLOW_DECAY = 9;

const GEOMETRY = {
  /** Inner and outer radius of the pad ring, as fractions of the box. */
  inner: 0.15,
  outer: 0.42,
  /** Gap between neighbouring pads, in radians. */
  gap: 0.07,
};

/** Clockwise from the top left, which is the order the pads are indexed in. */
const COLOURS = [
  { base: '34,197,94', lit: '134,255,171' }, // green
  { base: '239,68,68', lit: '255,150,150' }, // red
  { base: '234,179,8', lit: '253,230,138' }, // yellow
  { base: '59,130,246', lit: '147,197,253' }, // blue
] as const;

type Phase = 'showing' | 'input' | 'pause' | 'over';
type Result = 'win' | 'loss' | null;

/**
 * Simon.
 *
 * The only memory game in the set, and the only one that works with no audio at all -
 * which is the constraint that decided it. A desk toy that beeps while you are on a call
 * is a toy you uninstall, and Simon is the rare game where the sound is a duplicate of
 * the picture rather than half the information.
 *
 * It plays itself until you touch it, like Snake and Pong: an untouched Simon that flashes
 * one pad and then sits waiting forever would be a still frame with a timeout attached.
 * Once you have pressed a pad the autopilot is gone for the rest of the run and the
 * patience timer is what ends it if you wander off.
 */
export class Simon extends CanvasWidget {
  private sequence: number[] = [];
  private phase: Phase = 'pause';
  private result: Result = null;
  /** Rounds reproduced in full. In Simon the sequence length is the score. */
  private score = 0;
  /** Index into `sequence`, of what is being shown or what is expected next. */
  private step = 0;
  /** Per-pad brightness, 0 -> 1. Eased, so a press leaves a tail rather than a strobe. */
  private glow: number[] = [];
  /** The pad playback is holding lit right now, if any. */
  private lit: number | null = null;
  private showTimer = 0;
  private showLit = false;
  private waitTimer = 0;
  private patience = 0;
  private overTimer = 0;
  private autoTimer = 0;
  /** True until the first press. See the class comment. */
  private auto = true;
  private time = 0;

  private cx = 0;
  private cy = 0;

  private px(fraction: number): number {
    return fraction * this.size;
  }

  protected init(): void {
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.sequence = [];
    this.glow = new Array(PADS).fill(0);
    this.result = null;
    this.score = 0;
    this.overTimer = 0;
    this.auto = true;
    this.time = 0;
    // Straight into a playback: the first flash should be on screen as the window fades in.
    this.extend();
  }

  /** Add a step and show the whole sequence from the top, as the real toy does. */
  private extend(): void {
    this.sequence.push(this.nextPad());
    this.startPlayback();
  }

  /**
   * A pad for the end of the sequence, never the same one three times running.
   *
   * Uniform random is what the real toy does and it is right for the difficulty, but three
   * identical flashes in a row reads as the game having stopped rather than as a hard
   * sequence, and there is no way for the player to tell those apart.
   */
  private nextPad(): number {
    const n = this.sequence.length;
    const banned =
      n >= 2 && this.sequence[n - 1] === this.sequence[n - 2] ? this.sequence[n - 1] : -1;
    let pad = 0;
    do {
      pad = Math.floor(Math.random() * PADS) % PADS;
    } while (pad === banned);
    return pad;
  }

  private startPlayback(): void {
    this.phase = 'showing';
    this.step = 0;
    this.showLit = true;
    this.showTimer = this.flashLength();
    this.lit = this.sequence[0] ?? 0;
  }

  private flashLength(): number {
    return Math.max(FLASH_MIN, FLASH - FLASH_RAMP * (this.sequence.length - 1));
  }

  protected update(dt: number): void {
    this.time += dt;
    this.fadeGlow(dt);

    switch (this.phase) {
      case 'showing':
        this.playback(dt);
        break;
      case 'input':
        this.awaitPress(dt);
        break;
      case 'pause':
        this.waitTimer -= dt;
        if (this.waitTimer <= 0) this.extend();
        break;
      case 'over':
        this.overTimer += dt;
        if (this.overTimer >= OVER_PAUSE) this.finish();
        break;
    }
  }

  private fadeGlow(dt: number): void {
    const k = Math.min(1, dt * GLOW_DECAY);
    for (let i = 0; i < PADS; i++) {
      if (i === this.lit) {
        this.glow[i] = 1;
        continue;
      }
      this.glow[i] = this.glow[i]! * (1 - k);
    }
  }

  private playback(dt: number): void {
    this.showTimer -= dt;
    if (this.showTimer > 0) return;

    if (this.showLit) {
      // Lit -> dark. The gap is what separates two flashes of the same pad.
      this.showLit = false;
      this.lit = null;
      this.showTimer = this.flashLength() * GAP_RATIO;
      return;
    }

    this.step++;
    if (this.step >= this.sequence.length) {
      this.phase = 'input';
      this.step = 0;
      this.patience = PATIENCE;
      this.autoTimer = AUTO_PRESS;
      return;
    }
    this.showLit = true;
    this.showTimer = this.flashLength();
    this.lit = this.sequence[this.step]!;
  }

  private awaitPress(dt: number): void {
    if (this.auto) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoTimer = AUTO_PRESS;
        this.press(this.sequence[this.step]!);
      }
      return;
    }

    this.patience -= dt;
    if (this.patience <= 0) this.fail();
  }

  /** Register a press of `pad`, from the player or from the autopilot. */
  private press(pad: number): void {
    if (this.phase !== 'input') return;
    this.glow[pad] = 1;

    if (pad !== this.sequence[this.step]) {
      this.fail();
      return;
    }

    this.step++;
    this.patience = PATIENCE;
    if (this.step < this.sequence.length) return;

    this.score = this.sequence.length;
    if (this.score >= MAX_ROUNDS) {
      this.result = 'win';
      this.phase = 'over';
      this.overTimer = 0;
      return;
    }
    this.phase = 'pause';
    this.waitTimer = ROUND_PAUSE;
  }

  private fail(): void {
    this.result = 'loss';
    this.phase = 'over';
    this.overTimer = 0;
    this.lit = null;
  }

  /** Which pad a point is on, or null for the hub, the gaps, or outside the ring. */
  private padAt(x: number, y: number): number | null {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d < this.px(GEOMETRY.inner) || d > this.px(GEOMETRY.outer)) return null;

    // Pad 0 opens at pi (nine o'clock) and they run clockwise from there, so the indices
    // read top-left, top-right, bottom-right, bottom-left.
    const turn = Math.PI * 2;
    const a = (((Math.atan2(dy, dx) - Math.PI) % turn) + turn) % turn;
    return Math.min(PADS - 1, Math.floor(a / (Math.PI / 2)));
  }

  protected draw(): void {
    for (let i = 0; i < PADS; i++) this.drawPad(i);
    this.drawHub();
  }

  private drawPad(i: number): void {
    const ctx = this.ctx;
    const colour = COLOURS[i]!;
    const inner = this.px(GEOMETRY.inner);
    const outer = this.px(GEOMETRY.outer);
    const start = Math.PI + i * (Math.PI / 2) + GEOMETRY.gap / 2;
    const end = start + Math.PI / 2 - GEOMETRY.gap;

    // The result washes over the pads rather than being written on top of them: a losing
    // board goes dark, a winning one pulses, and neither needs a word to be read.
    let glow = this.glow[i]!;
    if (this.result === 'win') glow = 0.55 + 0.45 * Math.sin(this.time * 9 + i * 0.7);
    else if (this.result === 'loss') glow = 0;

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, outer, start, end);
    ctx.arc(this.cx, this.cy, inner, end, start, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(${colour.base},${0.26 + 0.62 * glow})`;
    ctx.fill();

    if (glow <= 0.04) return;
    // A brighter inset arc on top of the lit pad, so a flash is a change of shape as well
    // as of alpha - alpha alone is easy to miss against a busy desktop.
    const mid = (inner + outer) / 2;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, mid, start + GEOMETRY.gap, end - GEOMETRY.gap);
    ctx.strokeStyle = `rgba(${colour.lit},${0.85 * glow})`;
    ctx.lineWidth = (outer - inner) * 0.5 * glow;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /**
   * The hub, carrying the length reached.
   *
   * One digit is the most text this box can carry legibly, and it is the only number worth
   * having: in Simon the sequence length is the score.
   */
  private drawHub(): void {
    const ctx = this.ctx;
    const r = this.px(GEOMETRY.inner) * 0.86;

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    ctx.fill();
    ctx.strokeStyle =
      this.result === 'loss' ? 'rgba(248,113,113,0.7)' : 'rgba(226,232,240,0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.result === 'loss' ? 'rgba(248,113,113,0.95)' : 'rgba(241,245,249,0.95)';
    ctx.font = `600 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
    ctx.fillText(String(this.score), this.cx, this.cy);
    ctx.restore();
  }

  /**
   * Press on the way down, not on the way up.
   *
   * A pad that lights on release feels like it missed the input, and on a widget this
   * small the pointer has usually moved off the pad by then anyway.
   */
  override onPointerDown(x: number, y: number): void {
    if (this.phase === 'over') return;
    // Any click at all is a person arriving, even one that lands in a gap. Leaving the
    // autopilot running after that would have it answering over the top of them.
    this.auto = false;
    this.patience = PATIENCE;

    const pad = this.padAt(x, y);
    if (pad === null) return;
    this.press(pad);
  }
}
