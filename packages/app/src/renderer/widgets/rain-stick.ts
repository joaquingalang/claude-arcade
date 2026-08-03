import { beads } from '../audio';
import { CanvasWidget } from './types';

/**
 * A rain stick.
 *
 * Swing it and the beads pour the other way, clattering down through the baffles. The
 * sound is emergent rather than triggered - every tick is a bead that actually struck
 * something, so how dense the rain is depends on how steeply you tipped it, and it thins
 * out on its own as the beads pile up at the low end.
 *
 * The simulation runs in the tube's own frame rather than the world's: beads carry
 * positions along and across the tube, and tipping it rotates *gravity* instead of the
 * beads. That keeps the walls and baffles as fixed lines to test against at any angle,
 * which is the difference between a page of trigonometry per bead and two lines of it.
 */

const BEAD_COUNT = 44;
/** Tube geometry, as fractions of the box. */
const TUBE_LEN = 0.74;
const TUBE_W = 0.26;
const BEAD_R = 0.017;

/** Fractions of the box per second squared. */
const GRAVITY = 3.6;
const SUBSTEPS = 3;
/** Beads are hard and light; a soft tube would swallow the clatter that is the point. */
const BOUNCE = 0.42;
const PEG_BOUNCE = 0.5;
const DRAG = 0.995;

/** Rows of baffles down the tube, and pegs per row. */
const PEG_ROWS = 9;
const PEG_PER_ROW = 2;
const PEG_R = 0.014;

/** Impact speed below which a strike is felt but not heard, in fractions of the box. */
const TICK_SPEED = 0.22;
/** Ticks allowed per frame. A full cascade would otherwise ask for forty at once. */
const MAX_TICKS = 4;

/** How fast the tube swings toward where you are dragging, in radians per second. */
const SWING_RATE = 7;
/** Idle drift, so a stick nobody is holding still rains gently. */
const DRIFT_RATE = 0.24;

interface Bead {
  /** Across the tube, 0 at the axis. */
  ax: number;
  /** Along the tube, 0 at the A end. */
  ay: number;
  vx: number;
  vy: number;
  tint: number;
}

interface Peg {
  ax: number;
  ay: number;
}

export class RainStick extends CanvasWidget {
  private beads: Bead[] = [];
  private pegs: Peg[] = [];
  /** Angle of the tube's A-to-B axis, 0 meaning B points straight down. */
  private angle = 0;
  private target = 0;
  private dragging = false;
  private ticks = 0;

  private px(fraction: number): number {
    return fraction * this.size;
  }

  private get len(): number {
    return this.px(TUBE_LEN);
  }

  private get halfW(): number {
    return this.px(TUBE_W) / 2;
  }

  protected init(): void {
    this.angle = 0.35;
    this.target = 0.35;
    this.dragging = false;
    this.ticks = 0;

    const r = this.px(BEAD_R);
    const span = this.halfW - r;
    this.beads = Array.from({ length: BEAD_COUNT }, () => ({
      ax: (Math.random() * 2 - 1) * span,
      // Start piled at the low end rather than raining on arrival: the first thing you do
      // is tip it, and beads already falling would waste that.
      ay: this.len * (0.62 + Math.random() * 0.35),
      vx: 0,
      vy: 0,
      tint: Math.random(),
    }));

    this.pegs = [];
    for (let row = 0; row < PEG_ROWS; row++) {
      const ay = this.len * ((row + 0.85) / (PEG_ROWS + 0.7));
      for (let i = 0; i < PEG_PER_ROW; i++) {
        // Staggered row to row, so nothing has a clear run down the middle.
        const side = row % 2 === 0 ? -1 : 1;
        const offset = (i + 0.5) / PEG_PER_ROW;
        this.pegs.push({ ax: side * (offset - 0.5) * 2 * this.halfW * 0.62, ay });
      }
    }
  }

  protected update(dt: number): void {
    this.ticks = 0;

    if (this.dragging) {
      const diff = wrapPi(this.target - this.angle);
      const step = SWING_RATE * dt;
      this.angle += Math.max(-step, Math.min(step, diff));
    } else {
      // Left alone it keeps turning slowly, which is what keeps a trickle going.
      this.angle += DRIFT_RATE * dt;
    }
    this.angle = wrapPi(this.angle);

    const h = dt / SUBSTEPS;
    // Gravity resolved into the tube's frame - the whole reason the sim is written here.
    const g = this.px(GRAVITY);
    const gx = -g * Math.sin(this.angle);
    const gy = g * Math.cos(this.angle);

    for (let s = 0; s < SUBSTEPS; s++) {
      for (const b of this.beads) {
        b.vx += gx * h;
        b.vy += gy * h;
        b.vx *= DRAG;
        b.vy *= DRAG;
        b.ax += b.vx * h;
        b.ay += b.vy * h;
        this.walls(b);
        this.baffles(b);
      }
      this.separate();
      // Separation is a position fix with no regard for the walls, so a bead in a tight
      // pile gets shoved straight through one. Putting them back is the last word on where
      // a bead may be; it moves nothing and so is silent, unlike a real strike.
      for (const b of this.beads) this.confine(b);
    }
  }

  /** Clamp a bead inside the tube. Position only - no bounce, no sound. */
  private confine(b: Bead): void {
    const r = this.px(BEAD_R);
    const limit = this.halfW - r;
    b.ax = Math.max(-limit, Math.min(limit, b.ax));
    b.ay = Math.max(r, Math.min(this.len - r, b.ay));
  }

  private walls(b: Bead): void {
    const r = this.px(BEAD_R);
    const limit = this.halfW - r;

    if (b.ax < -limit) {
      b.ax = -limit;
      if (b.vx < 0) {
        this.strike(Math.abs(b.vx));
        b.vx *= -BOUNCE;
      }
    } else if (b.ax > limit) {
      b.ax = limit;
      if (b.vx > 0) {
        this.strike(Math.abs(b.vx));
        b.vx *= -BOUNCE;
      }
    }

    if (b.ay < r) {
      b.ay = r;
      if (b.vy < 0) {
        this.strike(Math.abs(b.vy));
        b.vy *= -BOUNCE;
      }
    } else if (b.ay > this.len - r) {
      b.ay = this.len - r;
      if (b.vy > 0) {
        this.strike(Math.abs(b.vy));
        b.vy *= -BOUNCE;
      }
    }
  }

  private baffles(b: Bead): void {
    const min = this.px(BEAD_R) + this.px(PEG_R);
    for (const peg of this.pegs) {
      const dx = b.ax - peg.ax;
      const dy = b.ay - peg.ay;
      const sq = dx * dx + dy * dy;
      if (sq >= min * min) continue;

      const d = Math.sqrt(sq) || 0.0001;
      const nx = dx / d;
      const ny = dy / d;
      b.ax = peg.ax + nx * min;
      b.ay = peg.ay + ny * min;

      const vn = b.vx * nx + b.vy * ny;
      if (vn >= 0) continue;
      this.strike(Math.abs(vn));
      b.vx -= (1 + PEG_BOUNCE) * vn * nx;
      b.vy -= (1 + PEG_BOUNCE) * vn * ny;
    }
  }

  /**
   * Keep beads from occupying the same spot.
   *
   * Position-only, with no impulse exchange: a pile at the low end has to stop sinking into
   * itself, but beads shoving each other audibly would double every tick that mattered.
   */
  private separate(): void {
    const min = this.px(BEAD_R) * 2;
    const n = this.beads.length;
    for (let i = 0; i < n; i++) {
      const a = this.beads[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = this.beads[j]!;
        const dx = b.ax - a.ax;
        const dy = b.ay - a.ay;
        const sq = dx * dx + dy * dy;
        if (sq >= min * min || sq === 0) continue;
        const d = Math.sqrt(sq);
        const push = (min - d) / 2;
        const nx = (dx / d) * push;
        const ny = (dy / d) * push;
        a.ax -= nx;
        a.ay -= ny;
        b.ax += nx;
        b.ay += ny;
      }
    }
  }

  /** One bead hitting something, if it hit hard enough and there is a voice spare. */
  private strike(speed: number): void {
    if (this.ticks >= MAX_TICKS) return;
    const threshold = this.px(TICK_SPEED);
    if (speed < threshold) return;
    this.ticks++;
    beads.tick(Math.min(1, speed / (threshold * 6)));
  }

  protected draw(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.rotate(this.angle);
    // Everything below is drawn in the tube's frame: +y runs from the A end to the B end.
    ctx.translate(0, -this.len / 2);

    this.drawTube();
    for (const peg of this.pegs) this.drawPeg(peg);
    for (const b of this.beads) this.drawBead(b);
    this.drawCaps();

    ctx.restore();
  }

  private drawTube(): void {
    const ctx = this.ctx;
    const w = this.halfW;

    const body = ctx.createLinearGradient(-w, 0, w, 0);
    body.addColorStop(0, 'rgba(92,60,32,0.9)');
    body.addColorStop(0.35, 'rgba(150,104,58,0.82)');
    body.addColorStop(1, 'rgba(74,46,24,0.92)');

    ctx.beginPath();
    ctx.rect(-w, 0, w * 2, this.len);
    ctx.fillStyle = body;
    ctx.fill();

    // A lit edge down one side, which is what stops a rectangle reading as a rectangle.
    ctx.beginPath();
    ctx.moveTo(-w * 0.55, this.px(0.02));
    ctx.lineTo(-w * 0.55, this.len - this.px(0.02));
    ctx.strokeStyle = 'rgba(255,228,190,0.16)';
    ctx.lineWidth = w * 0.34;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private drawPeg(peg: Peg): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(peg.ax, peg.ay, this.px(PEG_R), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56,34,16,0.85)';
    ctx.fill();
  }

  private drawBead(b: Bead): void {
    const ctx = this.ctx;
    const r = this.px(BEAD_R);
    // A little colour spread, so forty beads are not one bead drawn forty times.
    const hue = 34 + b.tint * 22;
    const g = ctx.createRadialGradient(b.ax - r * 0.35, b.ay - r * 0.35, r * 0.1, b.ax, b.ay, r);
    g.addColorStop(0, `hsl(${hue},70%,82%)`);
    g.addColorStop(1, `hsl(${hue},55%,52%)`);
    ctx.beginPath();
    ctx.arc(b.ax, b.ay, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /** The end caps, drawn over the beads so nothing appears to sit outside the tube. */
  private drawCaps(): void {
    const ctx = this.ctx;
    const w = this.halfW;
    const cap = this.px(0.035);
    ctx.fillStyle = 'rgba(48,30,15,0.95)';
    ctx.fillRect(-w * 1.08, -cap * 0.4, w * 2.16, cap);
    ctx.fillRect(-w * 1.08, this.len - cap * 0.6, w * 2.16, cap);
  }

  override onPointerDown(x: number, y: number): void {
    this.dragging = true;
    this.aim(x, y);
  }

  override onPointerMove(x: number, y: number): void {
    if (!this.dragging) return;
    this.aim(x, y);
  }

  override onPointerUp(): void {
    this.dragging = false;
  }

  /** Point the tube's low end at the pointer, which is how you tip a real one. */
  private aim(x: number, y: number): void {
    const dx = x - this.width / 2;
    const dy = y - this.height / 2;
    if (dx === 0 && dy === 0) return;
    this.target = Math.atan2(dx, dy);
  }
}

/** Fold an angle into (-pi, pi], so swinging past vertical takes the short way round. */
function wrapPi(a: number): number {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v <= -Math.PI) v += Math.PI * 2;
  return v;
}
