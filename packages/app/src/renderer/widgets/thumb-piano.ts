import { TINE_HZ, tines } from '../audio';
import { CanvasWidget } from './types';

/**
 * A kalimba.
 *
 * The toy in the set where the sound carries information rather than decoration. Simon
 * was built so its tones duplicate its colours and it plays correctly muted; this one is
 * the opposite case on purpose - silent it is a row of springy tines worth flicking, and
 * with sound on it is an instrument you can actually pick something out on.
 *
 * It sounds under a held pointer only - press to strike one tine, drag across to play a
 * phrase. Bubble wrap pops on a bare hover and this deliberately does not: a pop is a
 * one-shot, but a pointer crossing the board on its way somewhere else would fire off a
 * run of notes nobody asked for, and there is no way to take those back.
 *
 * The tines keep the traditional layout - lowest in the middle, alternating outwards - so
 * left to right is not a scale. That only works because the tuning is pentatonic: every
 * interval a stray pointer can produce is consonant, so a sweep across the whole board
 * sounds intended rather than like a mistake. See TINE_HZ in `../audio`.
 */

const COUNT = 7;

/**
 * Which note each tine plays, left to right.
 *
 * Centre is the lowest and the longest, and the notes climb alternately outwards, which is
 * how a kalimba is actually laid out and why it is shaped like a V.
 */
const NOTE_OF_TINE = [6, 4, 2, 0, 1, 3, 5];

/** Geometry, as fractions of the box. */
const BODY_X = 0.1;
const BODY_Y = 0.13;
const BODY_W = 0.8;
const BODY_H = 0.76;
/** Where the tines are clamped. Everything below this is free to vibrate. */
const BRIDGE_Y = 0.36;
const TINE_W = 0.032;
const TINE_SPACING = 0.098;
/** Length of the longest (centre) tine, and how much each step up shortens it. */
const TINE_LEN = 0.44;
const TINE_STEP = 0.052;

/** How far past a tine's tip still counts as a pluck. A 9px bar is not a precision target. */
const PLUCK_PAD = 0.03;

/** Seconds for a plucked tine's visible shimmer to die away. */
const RING_TIME = 0.85;
/** Lateral swing of a freshly plucked tip, as a fraction of the box. */
const SWING = 0.028;
/**
 * Visible wobble rate, in Hz - nothing to do with the pitch.
 *
 * A tine sounding at 523Hz moves far too fast to draw: sampled at 60fps it would alias
 * into a slow drift going the wrong way. These are the frequencies that read as vibration
 * to the eye, ordered so the short bright tines still visibly shiver faster.
 */
const WOBBLE_MIN = 15;
const WOBBLE_MAX = 26;

interface Tine {
  /** 1 -> 0 after a pluck; scales the swing. */
  ring: number;
  /** Advances only while ringing, so a still tine has a stable phase. */
  phase: number;
  wobble: number;
  note: number;
  len: number;
}

export class ThumbPiano extends CanvasWidget {
  private tines: Tine[] = [];
  /** The tine the pointer is currently over, so holding still does not machine-gun it. */
  private onTine = -1;
  /** True between pointer down and up. Nothing sounds unless the button is held. */
  private pressed = false;
  private lastX: number | null = null;
  private time = 0;

  private px(fraction: number): number {
    return fraction * this.size;
  }

  protected init(): void {
    this.onTine = -1;
    this.pressed = false;
    this.lastX = null;
    this.time = 0;
    this.tines = Array.from({ length: COUNT }, (_, i) => {
      const note = NOTE_OF_TINE[i] ?? 0;
      return {
        ring: 0,
        phase: 0,
        // Shorter tine, faster shiver.
        wobble: WOBBLE_MIN + ((WOBBLE_MAX - WOBBLE_MIN) * note) / (TINE_HZ.length - 1),
        note,
        len: this.px(TINE_LEN - note * TINE_STEP),
      };
    });
  }

  /** Centre line of tine `i`. */
  private tineX(i: number): number {
    return this.width / 2 + (i - (COUNT - 1) / 2) * this.px(TINE_SPACING);
  }

  protected update(dt: number): void {
    this.time += dt;
    for (const t of this.tines) {
      if (t.ring <= 0) continue;
      t.phase += dt * t.wobble * Math.PI * 2;
      t.ring = Math.max(0, t.ring - dt / RING_TIME);
    }
  }

  /**
   * Pluck whatever is under the pointer.
   *
   * Only fires when the pointer crosses from one tine to another, which is what turns a
   * sweep into a run of distinct notes instead of one note repeated every frame.
   */
  private touch(x: number, y: number): void {
    const hit = this.tineAt(x, y);
    if (hit === this.onTine) return;
    this.onTine = hit;
    if (hit < 0) return;

    const t = this.tines[hit]!;
    // A quick sweep hits harder than a slow one, the same way a real thumb does.
    const speed = this.lastX === null ? 0 : Math.abs(x - this.lastX) / this.px(TINE_SPACING);
    const velocity = Math.min(1, 0.45 + speed * 0.45);
    t.ring = 1;
    t.phase = 0;
    tines.pluck(t.note, velocity);
  }

  private tineAt(x: number, y: number): number {
    const half = this.px(TINE_SPACING) / 2;
    const top = this.px(BRIDGE_Y);
    for (let i = 0; i < COUNT; i++) {
      const t = this.tines[i]!;
      if (Math.abs(x - this.tineX(i)) > half) continue;
      if (y < top || y > top + t.len + this.px(PLUCK_PAD)) continue;
      return i;
    }
    return -1;
  }

  protected draw(): void {
    this.drawBody();
    for (let i = 0; i < COUNT; i++) this.drawTine(i);
    this.drawBridge();
  }

  private drawBody(): void {
    const ctx = this.ctx;
    const x = this.px(BODY_X);
    const y = this.px(BODY_Y);
    const w = this.px(BODY_W);
    const h = this.px(BODY_H);
    const r = this.px(0.09);

    const grain = ctx.createLinearGradient(x, y, x + w, y + h);
    grain.addColorStop(0, '#8b5a2b');
    grain.addColorStop(0.45, '#a56b33');
    grain.addColorStop(1, '#6f4520');

    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = grain;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,35,15,0.75)';
    ctx.lineWidth = Math.max(1.2, this.px(0.007));
    ctx.stroke();

    // The soundhole, which is also what stops the board reading as a plain slab.
    const hx = this.width / 2;
    const hy = this.px(0.245);
    const hole = ctx.createRadialGradient(hx, hy, this.px(0.005), hx, hy, this.px(0.05));
    hole.addColorStop(0, 'rgba(20,12,5,0.95)');
    hole.addColorStop(1, 'rgba(52,32,14,0.9)');
    ctx.beginPath();
    ctx.arc(hx, hy, this.px(0.05), 0, Math.PI * 2);
    ctx.fillStyle = hole;
    ctx.fill();
  }

  /**
   * One tine, bent by however hard it is still ringing.
   *
   * Drawn as a quadratic from the fixed base to a displaced tip: a straight bar that merely
   * slides sideways reads as the whole tine moving, and the thing that says "clamped at one
   * end" is the curve.
   */
  private drawTine(i: number): void {
    const ctx = this.ctx;
    const t = this.tines[i]!;
    const x = this.tineX(i);
    const top = this.px(BRIDGE_Y);
    const tip = top + t.len;
    const w = this.px(TINE_W);

    // An idle sway keeps a board nobody is touching from reading as a drawing of one.
    const idle = Math.sin(this.time * 1.1 + i * 0.9) * this.px(0.0016);
    const swing =
      t.ring > 0 ? Math.sin(t.phase) * this.px(SWING) * t.ring * t.ring : 0;
    const bend = swing + idle;

    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.quadraticCurveTo(x + bend * 0.45, (top + tip) / 2, x + bend, tip);

    const steel = ctx.createLinearGradient(x - w, top, x + w, tip);
    steel.addColorStop(0, '#8f9aa8');
    steel.addColorStop(0.4, '#e8eef5');
    steel.addColorStop(1, '#7d8896');
    ctx.strokeStyle = steel;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.stroke();

    // A blurred echo either side while it rings, which is what the eye reads as motion.
    if (t.ring > 0.02) {
      ctx.strokeStyle = `rgba(232,238,245,${0.28 * t.ring})`;
      ctx.lineWidth = w * 0.7;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.quadraticCurveTo(
          x + bend * 0.45 + side * w * 0.8,
          (top + tip) / 2,
          x + bend + side * w * 1.6 * t.ring,
          tip,
        );
        ctx.stroke();
      }
    }
  }

  /** The bar clamping every tine. Drawn last, so the tines vanish under it. */
  private drawBridge(): void {
    const ctx = this.ctx;
    const y = this.px(BRIDGE_Y);
    const h = this.px(0.05);
    const x = this.px(BODY_X + 0.03);
    const w = this.px(BODY_W - 0.06);

    const bar = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    bar.addColorStop(0, '#5b4327');
    bar.addColorStop(0.5, '#8a6a3f');
    bar.addColorStop(1, '#43301b');
    roundRect(ctx, x, y - h / 2, w, h, h / 2);
    ctx.fillStyle = bar;
    ctx.fill();
  }

  override onPointerDown(x: number, y: number): void {
    this.pressed = true;
    // Cleared first so tapping the same tine twice sounds twice.
    this.onTine = -1;
    this.lastX = x;
    this.touch(x, y);
  }

  /**
   * Dragging a held pointer across the board plays it.
   *
   * The press is what separates playing from passing through: one gesture covers both a
   * tap on a single tine and a glissando across all seven, and a pointer merely crossing
   * the widget stays silent. See the class comment.
   */
  override onPointerMove(x: number, y: number): void {
    if (!this.pressed) return;
    this.touch(x, y);
    this.lastX = x;
  }

  override onPointerUp(): void {
    this.pressed = false;
    this.onTine = -1;
    this.lastX = null;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}
