import { buzzer } from '../audio';
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

/**
 * Seconds a board that has never been touched waits before handing over.
 *
 * A game is exempt from the cycle clock, so one that waits to be started has to give up
 * by itself or it holds the rotation for the rest of the day. Matched to the toys' default
 * cycle: a game nobody chose to play should take no more of the screen than a toy does.
 */
const IDLE_PATIENCE = 15;

/**
 * The waiting board: a slow breath across the four pads, and how far each pad lags the
 * one before it so the breath travels round the ring rather than pulsing as one block.
 *
 * Deliberately dimmer than anything playback does. A board that is waiting has to look
 * unmistakably unlike a board that is showing you something to memorise.
 */
const IDLE_GLOW = 0.14;
const IDLE_BREATHE = 0.1;
const IDLE_RATE = 1.5;
const IDLE_LAG = 0.6;

/** How fast a pad's glow falls away once it is no longer held lit. */
const GLOW_DECAY = 9;

/**
 * How long a pressed pad sounds for, in seconds.
 *
 * Playback tones are as long as their flash, but a press has no length of its own - the
 * widget only ever hears the pointer go down. Short enough that hammering four pads in a
 * second stays four notes rather than a chord.
 */
const PRESS_TONE = 0.19;

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

type Phase = 'idle' | 'showing' | 'input' | 'pause' | 'over';
type Result = 'win' | 'loss' | null;

/**
 * Simon.
 *
 * The only memory game in the set, and the only one that works with no audio at all -
 * which is the constraint that decided it. A desk toy that beeps while you are on a call
 * is a toy you uninstall, and Simon is the rare game where the sound is a duplicate of
 * the picture rather than half the information. Every pad has a tone and nothing else
 * does: with sound on you can play it looking away, and with sound off you lose nothing.
 * The four pitches are the original toy's, and they are an A major chord - see `PAD_HZ`
 * in `../audio` for why that is not nostalgia.
 *
 * Unlike Snake, Pong and the rest, it does not start itself. Those play themselves because
 * a still board reads as broken, and Simon cannot borrow that trick: a sequence flashing
 * at someone who is not watching is a round they have already lost by the time they look
 * up, and one being answered by an autopilot is a round they were never offered. So the
 * board waits, breathing, until it is pressed - and a board nobody presses gives up after
 * `IDLE_PATIENCE` rather than holding the rotation forever.
 */
export class Simon extends CanvasWidget {
  private sequence: number[] = [];
  private phase: Phase = 'idle';
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
  /** Counts down while the board is waiting to be started. See the class comment. */
  private idleTimer = 0;
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
    this.lit = null;
    this.time = 0;
    // Waiting, not playing. Nothing flashes until someone asks for a sequence.
    this.phase = 'idle';
    this.idleTimer = IDLE_PATIENCE;
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
    this.flash(this.sequence[0] ?? 0);
  }

  /**
   * Light a pad for one step of playback, and sound it for exactly as long as it is lit.
   *
   * The tone is a duplicate of the light rather than a second half of it - see the class
   * comment - so the two have to start and stop together or the copy is a lie.
   */
  private flash(pad: number): void {
    this.showLit = true;
    this.showTimer = this.flashLength();
    this.lit = pad;
    buzzer.play(pad, this.showTimer);
  }

  private flashLength(): number {
    return Math.max(FLASH_MIN, FLASH - FLASH_RAMP * (this.sequence.length - 1));
  }

  protected update(dt: number): void {
    this.time += dt;
    this.fadeGlow(dt);

    switch (this.phase) {
      case 'idle':
        this.idleTimer -= dt;
        // Handing over unstarted, with no result: nobody lost a game they never began.
        if (this.idleTimer <= 0) this.finish();
        break;
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
      return;
    }
    this.flash(this.sequence[this.step]!);
  }

  private awaitPress(dt: number): void {
    this.patience -= dt;
    if (this.patience <= 0) this.fail();
  }

  /** Register a press of `pad`. */
  private press(pad: number): void {
    if (this.phase !== 'input') return;
    this.glow[pad] = 1;

    if (pad !== this.sequence[this.step]) {
      // No tone for the wrong pad: the blat is the answer, and sounding the pad first
      // would give it half a beat of sounding correct.
      this.fail();
      return;
    }
    buzzer.play(pad, PRESS_TONE);

    this.step++;
    this.patience = PATIENCE;
    if (this.step < this.sequence.length) return;

    this.score = this.sequence.length;
    if (this.score >= MAX_ROUNDS) {
      this.result = 'win';
      this.phase = 'over';
      this.overTimer = 0;
      buzzer.win();
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
    // Here rather than at the call sites, so a run that times out sounds like one that
    // was answered wrong. Both are the same ending and there is nothing to distinguish.
    buzzer.fail();
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
    else if (this.phase === 'idle') {
      glow = IDLE_GLOW + IDLE_BREATHE * Math.sin(this.time * IDLE_RATE - i * IDLE_LAG);
    }

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, outer, start, end);
    ctx.arc(this.cx, this.cy, inner, end, start, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(${colour.base},${0.26 + 0.62 * glow})`;
    ctx.fill();

    // A waiting pad keeps to a flat wash. The inset arc is what a *flash* looks like, and
    // lending it to the breath would make the idle board look like a sequence to copy.
    if (this.phase === 'idle' || glow <= 0.04) return;
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
   * The hub, carrying the length reached - or, before the run starts, the invitation.
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

    if (this.phase === 'idle') {
      this.drawStartGlyph(r);
      return;
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.result === 'loss' ? 'rgba(248,113,113,0.95)' : 'rgba(241,245,249,0.95)';
    ctx.font = `600 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
    ctx.fillText(String(this.score), this.cx, this.cy);
    ctx.restore();
  }

  /**
   * A play triangle where the score will go, breathing with the pads.
   *
   * A drawn shape rather than a "start" label: the widget is 280px and the hub is a tenth
   * of that, so any word small enough to fit is a word nobody reads. Nudged right of the
   * true centre because a triangle's mass sits left of its bounding box - centred by the
   * numbers it looks off-centre to the eye.
   */
  private drawStartGlyph(r: number): void {
    const ctx = this.ctx;
    const s = r * 0.62;
    const x = this.cx + s * 0.16;

    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, this.cy - s * 0.62);
    ctx.lineTo(x + s * 0.62, this.cy);
    ctx.lineTo(x - s * 0.5, this.cy + s * 0.62);
    ctx.closePath();
    const pulse = 0.62 + 0.22 * Math.sin(this.time * IDLE_RATE);
    ctx.fillStyle = `rgba(241,245,249,${pulse})`;
    ctx.fill();
  }

  /**
   * Press on the way down, not on the way up.
   *
   * A pad that lights on release feels like it missed the input, and on a widget this
   * small the pointer has usually moved off the pad by then anyway.
   */
  override onPointerDown(x: number, y: number): void {
    if (this.phase === 'over') return;

    // A waiting board is one big button: the click that starts the run is not a pad press,
    // so where it lands cannot be wrong. There is nothing to be wrong about yet.
    if (this.phase === 'idle') {
      this.extend();
      return;
    }

    this.patience = PATIENCE;
    const pad = this.padAt(x, y);
    if (pad === null) return;
    this.press(pad);
  }
}
