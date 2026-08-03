import { CanvasWidget } from './types';

const COLS = 6;
const ROWS = 6;
const TAU = Math.PI * 2;
/**
 * Lifetime of the shockwave *after* the bubble has already gone flat.
 *
 * The bubble does not animate down - it is a dimple from the first frame, and this is
 * only how long the ring that leaves it takes to travel out and fade.
 */
const POP_DURATION = 0.3;
/** Pause before the sheet refills, so the last pop is savoured rather than erased. */
const REFILL_DELAY = 0.8;
/** Bits of film thrown off by the burst. */
const SPECKS = 7;

interface Bubble {
  cx: number;
  cy: number;
  r: number;
  popped: boolean;
  /** 0 -> 1 while the shockwave travels outwards. */
  popT: number;
  /** Per-bubble jitter so the grid doesn't look machine-stamped. */
  wobble: number;
}

export class BubbleWrap extends CanvasWidget {
  private bubbles: Bubble[] = [];
  private refillTimer = 0;

  protected init(): void {
    this.build();
  }

  private build(): void {
    const pad = this.size * 0.08;
    const usable = this.size - pad * 2;
    const cell = usable / COLS;
    const r = cell * 0.42;

    this.bubbles = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const wobble = Math.random() * TAU;
        this.bubbles.push({
          // Nudged off the lattice by a fraction of a cell: real sheets are heat-sealed,
          // not printed, and a perfectly regular grid is the tell that this one is drawn.
          cx: pad + cell * (col + 0.5) + Math.cos(wobble) * cell * 0.035,
          cy: pad + cell * (row + 0.5) + Math.sin(wobble * 1.7) * cell * 0.035,
          r: r * (0.94 + 0.09 * (0.5 + 0.5 * Math.sin(wobble * 2.3))),
          popped: false,
          popT: 0,
          wobble,
        });
      }
    }
    this.refillTimer = 0;
  }

  protected update(dt: number): void {
    let allPopped = true;
    for (const b of this.bubbles) {
      if (!b.popped) {
        allPopped = false;
      } else if (b.popT < 1) {
        b.popT = Math.min(1, b.popT + dt / POP_DURATION);
      }
    }

    if (allPopped) {
      this.refillTimer += dt;
      if (this.refillTimer >= REFILL_DELAY) this.build();
    }
  }

  protected draw(): void {
    // A popped bubble is drawn dull immediately - there is no in-between state, no
    // deflation, no shrink. The pop is sold entirely by the wave that leaves it, which is
    // how real bubble wrap feels: the collapse is instant, the noise is what carries.
    for (const b of this.bubbles) {
      if (b.popped) this.drawDimple(b);
      else this.drawBubble(b);
    }

    // Shockwaves last, so a ring sweeps over its neighbours instead of under them.
    for (const b of this.bubbles) {
      if (b.popped && b.popT < 1) this.drawShockwave(b);
    }
  }

  private drawBubble(b: Bubble): void {
    const ctx = this.ctx;
    const lit = b.wobble * 0.12;
    const g = ctx.createRadialGradient(
      b.cx - b.r * 0.35,
      b.cy - b.r * 0.35,
      b.r * 0.1,
      b.cx,
      b.cy,
      b.r,
    );
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(186,214,255,0.72)');
    g.addColorStop(1, 'rgba(120,160,220,0.55)');

    ctx.beginPath();
    ctx.arc(b.cx, b.cy, b.r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Highlight - the thing that makes it read as "inflated" rather than "circle".
    ctx.beginPath();
    ctx.ellipse(
      b.cx - b.r * 0.32,
      b.cy - b.r * 0.38,
      b.r * 0.26,
      b.r * 0.16,
      -0.6 + lit,
      0,
      TAU,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
  }

  private drawShockwave(b: Bubble): void {
    const ctx = this.ctx;
    const t = b.popT;

    // Muzzle flash: a hot disc over the fresh dimple that *grows* as it dies. Growing
    // matters - a flash that shrank would read as the bubble sucking inwards, which is
    // the one thing a pop must never look like. Gone in a few frames.
    if (t < 0.22) {
      const f = 1 - t / 0.22;
      const rad = b.r * (0.8 + 0.5 * (1 - f));
      // Blue-cored rather than pure white: the widget floats over whatever wallpaper the
      // user has, and a white flash on a pale desktop is no flash at all.
      const g = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, rad);
      g.addColorStop(0, `rgba(255,255,255,${0.85 * f * f})`);
      g.addColorStop(0.6, `rgba(198,222,255,${0.6 * f * f})`);
      g.addColorStop(1, `rgba(120,160,220,0)`);
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, rad, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // Leading ring, then a fainter one a beat behind it. Radius eases out and the fade
    // is quadratic, so the wave leaves fast and thins as it goes.
    this.drawRing(b, t, 0.95);
    this.drawRing(b, (t - 0.18) / 0.82, 0.4);
    this.drawSpecks(b, t);
  }

  /** One expanding ring at progress `t`, skipped before it has left the bubble. */
  private drawRing(b: Bubble, t: number, alpha: number): void {
    if (t <= 0 || t >= 1) return;
    const ctx = this.ctx;
    const ease = 1 - (1 - t) ** 3;
    const fade = (1 - t) ** 2;

    ctx.beginPath();
    ctx.arc(b.cx, b.cy, b.r * (0.85 + ease * 1.9), 0, TAU);
    // Two passes over the same circle: a steel halo under a white core. The halo is what
    // keeps the wave readable against a light desktop, the core is what makes it snap.
    ctx.strokeStyle = `rgba(92,130,190,${alpha * fade * 0.5})`;
    ctx.lineWidth = 4.5 * fade + 1.2;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * fade})`;
    ctx.lineWidth = 2.4 * fade + 0.5;
    ctx.stroke();
  }

  /** A short burst of film flecks, thrown out along the wave. */
  private drawSpecks(b: Bubble, t: number): void {
    if (t >= 0.75) return;
    const ctx = this.ctx;
    const k = t / 0.75;
    const ease = 1 - (1 - k) ** 2;
    const fade = (1 - k) ** 2;

    ctx.fillStyle = `rgba(126,164,220,${0.7 * fade})`;
    for (let i = 0; i < SPECKS; i++) {
      // Jittered by the bubble's own phase, in angle *and* in speed. Flecks that all
      // travel at one speed stop reading as debris and start reading as a dashed ring.
      const a = b.wobble + (i / SPECKS) * TAU + Math.sin(b.wobble + i * 2.1) * 0.35;
      const reach = 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(b.wobble * 3.1 + i * 1.7));
      const d = b.r * (0.55 + ease * 1.6 * reach);
      ctx.beginPath();
      ctx.arc(b.cx + Math.cos(a) * d, b.cy + Math.sin(a) * d, b.r * 0.07 * fade + 0.3, 0, TAU);
      ctx.fill();
    }
  }

  /**
   * A spent bubble: a shallow crater with the light coming from the opposite side to the
   * fresh ones. That flip is what sells it - the eye reads an inverted highlight as a
   * dent without having to be told.
   */
  private drawDimple(b: Bubble): void {
    const ctx = this.ctx;
    const r = b.r * 0.94;

    const g = ctx.createRadialGradient(
      b.cx + r * 0.25,
      b.cy + r * 0.25,
      r * 0.1,
      b.cx,
      b.cy,
      r,
    );
    g.addColorStop(0, 'rgba(108,128,164,0.3)');
    g.addColorStop(0.72, 'rgba(108,128,164,0.15)');
    g.addColorStop(1, 'rgba(108,128,164,0.04)');
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    // Rim: shaded where the fresh bubble was lit, lit where it was shaded.
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r, Math.PI * 0.75, Math.PI * 1.75);
    ctx.strokeStyle = 'rgba(70,90,130,0.22)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r, Math.PI * 1.75, Math.PI * 0.75);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // One slack crease across the collapsed film.
    ctx.beginPath();
    ctx.arc(
      b.cx + Math.cos(b.wobble) * r * 0.5,
      b.cy + Math.sin(b.wobble) * r * 0.5,
      r * 0.8,
      b.wobble + 1.9,
      b.wobble + 3.5,
    );
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  override onPointerDown(x: number, y: number): void {
    this.popAt(x, y);
  }

  /** Hovering across the sheet pops a trail, which is most of the fun. */
  override onPointerMove(x: number, y: number): void {
    this.popAt(x, y);
  }

  private popAt(x: number, y: number): void {
    for (const b of this.bubbles) {
      if (b.popped) continue;
      const dx = x - b.cx;
      const dy = y - b.cy;
      if (dx * dx + dy * dy <= b.r * b.r) {
        b.popped = true;
        b.popT = 0;
        return;
      }
    }
  }
}
