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

/**
 * A finish is a colourway that needs more than a flat gradient to read right.
 *
 * `gold` rakes its highlight from a fixed point in the room instead of a fixed point on
 * the part, which is the difference between metal and yellow plastic. `prismatic` is the
 * rare pull: an oil-slick sheen over pearl, a halo, and glints off the lobe tips.
 */
export type Finish = 'gold' | 'prismatic';

export interface Colorway {
  /** Also what you set on `window.widgets` in the harness to force a pull. */
  id: string;
  /** Three stops taken across the body, corner to corner. */
  body: readonly [string, string, string];
  /** What the spin ghosts smear into - a light, desaturated take on the body. */
  ghost: string;
  /** Lit edge, mid, shaded edge. Defaults to the neutral white-to-navy rim. */
  rim?: readonly [string, string, string];
  /** Relative frequency of this pull, not a percentage - see `rollColorway`. */
  weight: number;
  finish?: Finish;
}

const RIM_DEFAULT = [
  'rgba(255,255,255,0.75)',
  'rgba(255,255,255,0.16)',
  'rgba(40,55,100,0.35)',
] as const;

/**
 * The pull table.
 *
 * Weights are relative, so a colourway can be added or retuned without recomputing
 * anybody else's odds. As it stands the commons are 90.8% between them, gold is 7.5%,
 * and prismatic is 1.7% - rare enough that you remember seeing it.
 */
export const COLORWAYS: readonly Colorway[] = [
  // The original body gradient, kept as one pull among many rather than retired.
  { id: 'aurora', body: ['#8ad4fb', '#7d8cf5', '#b478f0'], ghost: '#93a8ff', weight: 100 },
  { id: 'ember', body: ['#ffd08a', '#ff8a5c', '#e0457b'], ghost: '#ffa07f', weight: 100 },
  { id: 'jade', body: ['#b6f7d8', '#3fd6a5', '#0f8f8d'], ghost: '#6ee5c0', weight: 100 },
  { id: 'bubblegum', body: ['#ffe0f4', '#ff8ecb', '#a45cf0'], ghost: '#ffa8dc', weight: 100 },
  { id: 'citrus', body: ['#fff6a8', '#ffd23f', '#f27a1a'], ghost: '#ffdc72', weight: 100 },
  { id: 'abyss', body: ['#5fd0ff', '#2f6bd8', '#1a2266'], ghost: '#5c8ce8', weight: 100 },
  {
    id: 'graphite',
    body: ['#9aa7bf', '#4d5872', '#20273a'],
    ghost: '#7d8aa6',
    rim: ['rgba(255,255,255,0.62)', 'rgba(255,255,255,0.12)', 'rgba(10,14,26,0.5)'],
    weight: 100,
  },
  {
    id: 'gold',
    body: ['#fff4cd', '#e8bd4e', '#8a5f0c'],
    ghost: '#ffd98a',
    rim: ['rgba(255,247,214,0.9)', 'rgba(255,236,176,0.22)', 'rgba(88,54,6,0.5)'],
    weight: 58,
    finish: 'gold',
  },
  {
    id: 'prismatic',
    // Pearl underneath; the conic rainbow rides on top of it, so this is the base coat.
    body: ['#ffffff', '#eef3ff', '#dfe6f7'],
    ghost: '#cfe9ff',
    rim: ['rgba(255,255,255,0.95)', 'rgba(210,240,255,0.3)', 'rgba(70,40,120,0.35)'],
    weight: 13,
    finish: 'prismatic',
  },
];

const TOTAL_WEIGHT = COLORWAYS.reduce((sum, c) => sum + c.weight, 0);

/**
 * Pick a colourway for one opening of the spinner.
 *
 * `roll` is injectable so the odds can be tested at the boundaries instead of by
 * sampling, and so the harness can force a specific pull.
 */
export function rollColorway(roll: number = Math.random()): Colorway {
  let ticket = Math.min(Math.max(roll, 0), 0.999999) * TOTAL_WEIGHT;
  for (const c of COLORWAYS) {
    ticket -= c.weight;
    if (ticket < 0) return c;
  }
  return COLORWAYS[0]!;
}

/** World-space direction the key light rakes across the body, matching the flat gradient. */
const LIGHT_ANGLE = Math.PI / 4;

/** Alternating light and dark bands - what makes gold read as metal rather than yellow. */
const GOLD_BANDS: ReadonlyArray<[number, string]> = [
  [0, '#fff8de'],
  [0.14, '#f6dd93'],
  [0.28, '#d3a02c'],
  [0.4, '#a9760f'],
  [0.52, '#f0cd6c'],
  [0.63, '#ffefba'],
  [0.76, '#c9932a'],
  [0.88, '#8e6210'],
  [1, '#ffe9a8'],
];

/** Hue stops for the prismatic slick, in degrees around the hub. */
const SLICK_STOPS = 9;
const SLICK_ALPHA = 0.62;
/** How much faster the slick counter-rotates than the body, so the colours visibly flow. */
const SLICK_DRIFT = 2.4;

export class FidgetSpinner extends CanvasWidget {
  private angle = 0;
  private omega = 0;
  private dragging = false;
  private lastPointerAngle = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  /** Rolled once per opening, in `init` - a fresh window is a fresh pull. */
  private skin: Colorway = COLORWAYS[0]!;

  protected init(): void {
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    this.radius = this.size * 0.4;
    this.angle = 0;
    // A gentle idle spin, so it looks alive the moment it appears.
    this.omega = 2.5;
    this.skin = rollColorway();
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

  /**
   * A gradient raked across the body along a *world* axis.
   *
   * The body path is traced inside `rotate(this.angle)`, so an axis that is constant in
   * local space turns with the part and the highlight goes along for the ride. Undoing
   * the body's rotation pins the light to the room instead, which is the whole reason
   * metal glitters as it turns.
   */
  private rakedGradient(R: number, stops: ReadonlyArray<[number, string]>): CanvasGradient {
    const a = LIGHT_ANGLE - this.angle;
    const dx = Math.cos(a) * R * Math.SQRT2;
    const dy = Math.sin(a) * R * Math.SQRT2;
    const grad = this.ctx.createLinearGradient(-dx, -dy, dx, dy);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    return grad;
  }

  /** The body fill for the current colourway, in the body's own rotated frame. */
  private bodyFill(R: number): CanvasGradient {
    const [a, b, c] = this.skin.body;
    if (this.skin.finish === 'gold') return this.rakedGradient(R, GOLD_BANDS);
    const grad = this.ctx.createLinearGradient(-R, -R, R, R);
    grad.addColorStop(0, a);
    grad.addColorStop(0.5, b);
    grad.addColorStop(1, c);
    return grad;
  }

  /**
   * The oil-slick pass: a full-spectrum conic sweep laid over the pearl base.
   *
   * It counter-rotates faster than the body, so the bands wash around the arms instead of
   * sitting still on them - the colour is light on the surface, not paint under it.
   */
  private drawSlick(R: number): void {
    const ctx = this.ctx;
    const slick = ctx.createConicGradient(-this.angle * SLICK_DRIFT, 0, 0);
    for (let i = 0; i <= SLICK_STOPS; i++) {
      const t = i / SLICK_STOPS;
      slick.addColorStop(t, `hsla(${Math.round(t * 360)}, 100%, 68%, ${SLICK_ALPHA})`);
    }
    this.traceOutline();
    this.traceBores();
    ctx.fillStyle = slick;
    ctx.fill('evenodd');

    // A hot band raked across the slick, pinned to the room like the gold highlight.
    const bar = this.rakedGradient(R, [
      [0, 'rgba(255,255,255,0)'],
      [0.42, 'rgba(255,255,255,0.5)'],
      [0.5, 'rgba(255,255,255,0.78)'],
      [0.58, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.traceOutline();
    this.traceBores();
    ctx.fillStyle = bar;
    ctx.fill('evenodd');
  }

  /**
   * The halo the prismatic body throws onto the desktop behind it.
   *
   * Its hue walks with the spin and its strength with the speed, so a resting spinner
   * only shimmers and a flicked one blooms. Capped at 1.18R, which still clears the
   * window box - the body itself already reaches exactly 1R.
   */
  private drawHalo(R: number, blur: number): void {
    const ctx = this.ctx;
    const hue = Math.round(((this.angle * 60) % 360) + 360) % 360;
    const alpha = 0.1 + 0.32 * blur;
    const halo = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 1.18);
    halo.addColorStop(0, `hsla(${hue}, 100%, 70%, ${alpha})`);
    halo.addColorStop(0.55, `hsla(${(hue + 90) % 360}, 100%, 66%, ${alpha * 0.55})`);
    halo.addColorStop(1, `hsla(${(hue + 180) % 360}, 100%, 62%, 0)`);
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.18, 0, TAU);
    ctx.fillStyle = halo;
    ctx.fill();
  }

  /**
   * Glints at the three lobe tips: a four-point star plus a hot core.
   *
   * Twinkled off the spin angle rather than wall time, so they pulse as the spinner turns
   * and settle when it stops - and they fade as the blur comes up, where the ghosts have
   * already taken over the eye.
   */
  private drawGlints(R: number, blur: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < LOBES; i++) {
      const a = (i / LOBES) * TAU;
      const d = (LOBE_D + LOBE_R * 0.5) * R;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const twinkle = 0.5 + 0.5 * Math.sin(this.angle * 3 + (i * TAU) / LOBES);
      const amp = (0.3 + 0.7 * twinkle) * (1 - 0.55 * blur);
      const arm = R * 0.15 * (0.55 + 0.45 * twinkle);

      ctx.globalAlpha = amp;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, R * 0.012);
      ctx.beginPath();
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      ctx.stroke();

      const core = ctx.createRadialGradient(x, y, 0, x, y, arm * 0.5);
      core.addColorStop(0, 'rgba(255,255,255,0.95)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(x, y, arm * 0.5, 0, TAU);
      ctx.fillStyle = core;
      ctx.fill();
    }
    ctx.restore();
  }

  protected draw(): void {
    const ctx = this.ctx;
    const R = this.radius;
    const blur = Math.min(1, Math.abs(this.omega) / BLUR_FULL);

    ctx.save();
    ctx.translate(this.cx, this.cy);

    // Behind everything, so the body sits in its own glow rather than under a wash.
    if (this.skin.finish === 'prismatic') this.drawHalo(R, blur);

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
        ctx.fillStyle = this.skin.ghost;
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
    ctx.fillStyle = this.bodyFill(R);
    ctx.fill('evenodd');
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Over the pearl base but under the sheen, so the slick still takes the moulded
    // highlight rather than sitting flat on top of it.
    if (this.skin.finish === 'prismatic') this.drawSlick(R);

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
    const [lit, mid, shade] = this.skin.rim ?? RIM_DEFAULT;
    const rim = ctx.createLinearGradient(-R * 0.6, -R * 0.8, R * 0.6, R * 0.8);
    rim.addColorStop(0, lit);
    rim.addColorStop(0.5, mid);
    rim.addColorStop(1, shade);
    this.traceOutline();
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(1.2, R * 0.026);
    ctx.stroke();

    for (let i = 0; i < LOBES; i++) {
      const [lx, ly] = this.lobeAt(i);
      this.drawBearing(lx, ly, R * BEARING_R, R * BORE_R);
    }

    // Last of the rotating passes: glints belong on top of the bearings, not under them.
    if (this.skin.finish === 'prismatic') this.drawGlints(R, blur);

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
