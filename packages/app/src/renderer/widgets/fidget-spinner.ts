import { CanvasWidget } from './types';

const LOBES = 3;
/** Per-second proportional decay. Slow enough that a good flick spins for many seconds. */
const FRICTION = 0.35;
const MAX_OMEGA = 45;
const TAU = Math.PI * 2;

/**
 * Silhouette proportions, as fractions of `radius` (the outer extent of a lobe).
 *
 * A real tri-spinner is a round hub boss and three round lobes joined by *narrow arms*,
 * each arm scooped in from both sides by a concave fillet. That waist is the whole
 * difference between a spinner and three circles stuck onto a blob, so the outline is
 * built from those four arcs per arm rather than approximated.
 */
const LOBE_R = 0.32;
const LOBE_D = 0.68;
const HUB_R = 0.29;
const FILLET_R = 0.17;

/**
 * Centre of an arm's fillet, in the frame where that arm's lobe sits on +x.
 *
 * Solved from the two tangency conditions - `HUB_R + FILLET_R` from the origin and
 * `LOBE_R + FILLET_R` from the lobe centre - so consecutive arcs meet exactly and the
 * outline has no seams to paper over.
 */
const FILLET_X =
  (LOBE_D ** 2 + (HUB_R + FILLET_R) ** 2 - (LOBE_R + FILLET_R) ** 2) / (2 * LOBE_D);
const FILLET_Y = Math.sqrt((HUB_R + FILLET_R) ** 2 - FILLET_X ** 2);
const FILLET_D = HUB_R + FILLET_R;
/** Half the angle an arm subtends at the hub - where its two fillets meet the boss. */
const FILLET_PHI = Math.atan2(FILLET_Y, FILLET_X);

/** The open hole through each lobe, and the bearing race pressed into it. */
const BORE_R = 0.11;
const BEARING_R = 0.235;
const HUB_BEARING_R = 0.22;
const HUB_CAP_R = 0.15;

/** Angular speed at which the spin blur reaches full strength. */
const BLUR_FULL = 14;
const GHOSTS = 10;

export class FidgetSpinner extends CanvasWidget {
  private angle = 0;
  private omega = 0;
  private dragging = false;
  private lastPointerAngle = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;

  protected init(): void {
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    this.radius = this.size * 0.4;
    this.angle = 0;
    // A gentle idle spin, so it looks alive the moment it appears.
    this.omega = 2.5;
  }

  protected update(dt: number): void {
    if (this.dragging) return;
    this.angle += this.omega * dt;
    // Exponential decay rather than linear: it never crosses zero and reverses.
    this.omega *= Math.exp(-FRICTION * dt);
    if (Math.abs(this.omega) < 0.02) this.omega = 0;
  }

  /** Centre of lobe `i`, in body space. */
  private lobeAt(i: number): [number, number] {
    const a = ((i % LOBES) / LOBES) * TAU;
    return [Math.cos(a) * LOBE_D * this.radius, Math.sin(a) * LOBE_D * this.radius];
  }

  /** Centre of the fillet sitting at angle `a` around the hub. */
  private filletAt(a: number): [number, number] {
    return [Math.cos(a) * FILLET_D * this.radius, Math.sin(a) * FILLET_D * this.radius];
  }

  /**
   * The body outline: hub boss, then per arm a leading fillet, the lobe cap, a trailing
   * fillet. Every arc is tangent to the next, so this traces as one closed curve.
   */
  private traceOutline(): void {
    const ctx = this.ctx;
    const R = this.radius;

    ctx.beginPath();
    for (let i = 0; i < LOBES; i++) {
      const a = (i / LOBES) * TAU;
      const [lx, ly] = this.lobeAt(i);
      const [f1x, f1y] = this.filletAt(a - FILLET_PHI);
      const [f2x, f2y] = this.filletAt(a + FILLET_PHI);

      // Hub boss, from where the previous arm left it to where this one starts.
      ctx.arc(0, 0, HUB_R * R, a - TAU / LOBES + FILLET_PHI, a - FILLET_PHI);
      // Leading fillet: concave, so it is swept back the other way between its tangents.
      ctx.arc(
        f1x,
        f1y,
        FILLET_R * R,
        Math.atan2(-f1y, -f1x),
        Math.atan2(ly - f1y, lx - f1x),
        true,
      );
      // Lobe cap: swept forwards, so it goes the long way round past the outer tip.
      ctx.arc(lx, ly, LOBE_R * R, Math.atan2(f1y - ly, f1x - lx), Math.atan2(f2y - ly, f2x - lx));
      // Trailing fillet, back down onto the boss.
      ctx.arc(
        f2x,
        f2y,
        FILLET_R * R,
        Math.atan2(ly - f2y, lx - f2x),
        Math.atan2(-f2y, -f2x),
        true,
      );
    }
    ctx.closePath();
  }

  /** The three open bores, as sub-paths for an even-odd fill. */
  private traceBores(): void {
    const ctx = this.ctx;
    const r = this.radius * BORE_R;
    for (let i = 0; i < LOBES; i++) {
      const [lx, ly] = this.lobeAt(i);
      ctx.moveTo(lx + r, ly);
      ctx.arc(lx, ly, r, 0, TAU);
    }
  }

  /**
   * A bearing seated in a bore: a brushed-metal race with the hole left open, plus the
   * two seams that make it read as a part pressed into the body rather than paint.
   */
  private drawBearing(x: number, y: number, outer: number, hole: number): void {
    const ctx = this.ctx;

    ctx.beginPath();
    ctx.arc(x, y, outer, 0, TAU);
    ctx.moveTo(x + hole, y);
    ctx.arc(x, y, hole, 0, TAU);
    const race = ctx.createLinearGradient(x - outer, y - outer, x + outer, y + outer);
    race.addColorStop(0, '#f8fbff');
    race.addColorStop(0.32, '#d5dfef');
    race.addColorStop(0.6, '#a3b2cc');
    race.addColorStop(0.84, '#cdd8ea');
    race.addColorStop(1, '#eef3fb');
    ctx.fillStyle = race;
    ctx.fill('evenodd');

    ctx.beginPath();
    ctx.arc(x, y, outer, 0, TAU);
    ctx.strokeStyle = 'rgba(34,48,84,0.45)';
    ctx.lineWidth = Math.max(1, outer * 0.09);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, hole, 0, TAU);
    ctx.strokeStyle = 'rgba(28,40,72,0.55)';
    ctx.lineWidth = Math.max(1, outer * 0.12);
    ctx.stroke();
  }

  protected draw(): void {
    const ctx = this.ctx;
    const R = this.radius;
    const blur = Math.min(1, Math.abs(this.omega) / BLUR_FULL);

    ctx.save();
    ctx.translate(this.cx, this.cy);

    // Spin blur: ghost bodies trailing the real one. Cheaper than a real blur, and it
    // reads better - the lobes smear into a disc the way a fast spinner actually does.
    if (blur > 0.02) {
      const dir = Math.sign(this.omega);
      const spread = 0.75 * blur;
      for (let g = GHOSTS; g >= 1; g--) {
        ctx.save();
        ctx.rotate(this.angle - dir * spread * (g / GHOSTS));
        ctx.globalAlpha = 0.11 * blur * (1 - g / (GHOSTS + 1));
        this.traceOutline();
        this.traceBores();
        ctx.fillStyle = '#93a8ff';
        ctx.fill('evenodd');
        ctx.restore();
      }
    }

    ctx.save();
    ctx.rotate(this.angle);

    // Body, bores punched out by the even-odd rule so the desktop shows through them.
    ctx.shadowColor = 'rgba(15,25,55,0.38)';
    ctx.shadowBlur = R * 0.14;
    ctx.shadowOffsetY = R * 0.05;
    this.traceOutline();
    this.traceBores();
    const grad = ctx.createLinearGradient(-R, -R, R, R);
    grad.addColorStop(0, '#8ad4fb');
    grad.addColorStop(0.5, '#7d8cf5');
    grad.addColorStop(1, '#b478f0');
    ctx.fillStyle = grad;
    ctx.fill('evenodd');
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Sheen across the upper-left face: the cue that the body is moulded, not flat. It
    // re-fills the same path rather than clipping one, so nothing is ever painted
    // outside the silhouette.
    const sheen = ctx.createLinearGradient(-R * 0.7, -R, R * 0.3, R * 0.5);
    sheen.addColorStop(0, 'rgba(255,255,255,0.55)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.08)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    this.traceOutline();
    this.traceBores();
    ctx.fillStyle = sheen;
    ctx.fill('evenodd');

    // Rim: lit along the top-left edge, shaded along the bottom-right, which is what
    // gives the body thickness. One gradient stroke does both.
    const rim = ctx.createLinearGradient(-R * 0.6, -R * 0.8, R * 0.6, R * 0.8);
    rim.addColorStop(0, 'rgba(255,255,255,0.75)');
    rim.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    rim.addColorStop(1, 'rgba(40,55,100,0.35)');
    this.traceOutline();
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(1.2, R * 0.026);
    ctx.stroke();

    for (let i = 0; i < LOBES; i++) {
      const [lx, ly] = this.lobeAt(i);
      this.drawBearing(lx, ly, R * BEARING_R, R * BORE_R);
    }

    ctx.restore();

    // Hub, drawn unrotated so it reads as the stationary bearing the body turns around.
    this.drawBearing(0, 0, R * HUB_BEARING_R, R * HUB_CAP_R * 0.62);

    const cap = ctx.createRadialGradient(
      -R * HUB_CAP_R * 0.45,
      -R * HUB_CAP_R * 0.45,
      R * 0.015,
      0,
      0,
      R * HUB_CAP_R,
    );
    cap.addColorStop(0, '#ffffff');
    cap.addColorStop(0.5, '#e2e9f6');
    cap.addColorStop(1, '#9fadc6');
    ctx.beginPath();
    ctx.arc(0, 0, R * HUB_CAP_R, 0, TAU);
    ctx.fillStyle = cap;
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,90,140,0.45)';
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, R * HUB_CAP_R * 0.38, 0, TAU);
    ctx.strokeStyle = 'rgba(120,140,180,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  private pointerAngle(x: number, y: number): number {
    return Math.atan2(y - this.cy, x - this.cx);
  }

  override onPointerDown(x: number, y: number): void {
    this.dragging = true;
    this.omega = 0;
    this.lastPointerAngle = this.pointerAngle(x, y);
  }

  override onPointerMove(x: number, y: number): void {
    if (!this.dragging) return;
    const a = this.pointerAngle(x, y);
    let delta = a - this.lastPointerAngle;
    // Unwrap across the -pi/pi seam, or one drag past it would fling the spinner.
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;

    this.angle += delta;
    this.lastPointerAngle = a;
    // Track instantaneous rate so releasing mid-drag imparts the flick's momentum.
    this.omega = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, delta * 60));
  }

  override onPointerUp(): void {
    this.dragging = false;
  }
}
