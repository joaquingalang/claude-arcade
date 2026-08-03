import { CanvasWidget } from './types';

const FILAMENTS = 5;
/** Points per arc. Enough to look torn rather than drawn; few enough to be free. */
const SEGMENTS = 18;
/** How many filaments the pointer can pull at once. */
const ATTRACTED = 2;

/** Radians per second the arc's foot chases its target at. */
const CHASE = 6;
const RETARGET_MIN = 0.7;
const RETARGET_MAX = 2.8;
/** Chance a retarget is a jump to somewhere else entirely rather than a nudge. */
const JUMP_CHANCE = 0.25;

/**
 * How long a pointer position is trusted after the last move, in seconds.
 *
 * The canvas only hears about the pointer leaving when a drag is in progress, so a hover
 * that wanders off the window would otherwise pin the arcs to a stale position forever.
 * Letting the position go stale is the only reliable way to notice the hand has gone.
 */
const POINTER_HOLD = 0.45;

interface Filament {
  /** Where the arc meets the glass, in radians. */
  angle: number;
  target: number;
  /** Seconds until this arc picks a new target. */
  retarget: number;
  /** Phase offset, so the five arcs don't writhe in unison. */
  seed: number;
  /** How far this arc bows away from a straight line, in radians. */
  amp: number;
  /** 0 -> 1, eased. Drives both stroke width and colour. */
  bright: number;
}

/**
 * A plasma globe.
 *
 * Arcs are drawn, not simulated: each one is a straight line from the electrode to the
 * glass with a wobble laid over it, and the wobble is two sines that vanish at both ends.
 * That pins every arc to the electrode and to its point of contact - the two places a
 * real one is pinned - while the middle writhes. A particle simulation would cost far
 * more and look less like plasma, which is not a physical process anyone can recall well
 * enough to miss.
 *
 * Hovering pulls the nearest arcs to the pointer and brightens them, which is the whole
 * reason anyone has ever touched one of these. No click needed: a plasma globe you have
 * to press would be a button.
 */
export class PlasmaGlobe extends CanvasWidget {
  private filaments: Filament[] = [];
  private time = 0;
  private cx = 0;
  private cy = 0;
  private globeR = 0;
  private coreR = 0;
  /** Last seen pointer, in canvas coordinates, or null once it has gone stale. */
  private pointer: { x: number; y: number } | null = null;
  private pointerAge = 0;

  protected init(): void {
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.globeR = this.size * 0.4;
    this.coreR = this.globeR * 0.15;
    this.time = 0;
    this.pointer = null;

    this.filaments = Array.from({ length: FILAMENTS }, (_, i) => {
      // Spread the opening angles evenly. Randomising them can deal three arcs into the
      // same quadrant, and a globe with a bald side reads as broken rather than random.
      const angle = (i / FILAMENTS) * Math.PI * 2 + Math.random() * 0.5;
      return {
        angle,
        target: angle,
        retarget: RETARGET_MIN + Math.random() * (RETARGET_MAX - RETARGET_MIN),
        seed: Math.random() * Math.PI * 2,
        amp: 0.2 + Math.random() * 0.3,
        bright: 0.5 + Math.random() * 0.3,
      };
    });
  }

  protected update(dt: number): void {
    this.time += dt;

    this.pointerAge += dt;
    if (this.pointerAge > POINTER_HOLD) this.pointer = null;

    const pull = this.pointerAngle();
    const attracted = pull === null ? null : this.nearestTo(pull);

    for (let i = 0; i < this.filaments.length; i++) {
      const f = this.filaments[i]!;
      const held = attracted !== null && attracted.has(i);

      if (held && pull !== null) {
        // Held arcs are aimed straight at the finger, fanned slightly so two of them
        // arriving at the same spot still read as two arcs.
        f.target = pull + (i % 2 === 0 ? 0.1 : -0.1);
        f.retarget = Math.max(f.retarget, 0.4);
      } else {
        f.retarget -= dt;
        if (f.retarget <= 0) {
          f.target = f.angle + this.hop();
          f.retarget = RETARGET_MIN + Math.random() * (RETARGET_MAX - RETARGET_MIN);
          f.amp = 0.2 + Math.random() * 0.3;
        }
      }

      // Ease along the short way round, so an arc crossing the -pi/pi seam takes the
      // near side instead of sweeping the whole globe.
      f.angle += angleDelta(f.angle, f.target) * Math.min(1, dt * CHASE);

      // Flicker: two unrelated sines around a base that lifts when the arc is held.
      const base = held ? 0.95 : 0.6;
      const flicker =
        Math.sin(this.time * 11 + f.seed) * 0.12 + Math.sin(this.time * 27 + f.seed * 3) * 0.06;
      f.bright += (base + flicker - f.bright) * Math.min(1, dt * 9);
    }
  }

  /** A new target relative to the current one: usually a nudge, sometimes a leap. */
  private hop(): number {
    if (Math.random() < JUMP_CHANCE) return (Math.random() - 0.5) * Math.PI * 2;
    return (Math.random() - 0.5) * 1.6;
  }

  /** The angle the pointer is asking for, or null if it is not on the glass. */
  private pointerAngle(): number | null {
    if (!this.pointer) return null;
    const dx = this.pointer.x - this.cx;
    const dy = this.pointer.y - this.cy;
    // Outside the glass there is nothing to conduct through, so nothing happens.
    if (dx * dx + dy * dy > this.globeR * this.globeR) return null;
    return Math.atan2(dy, dx);
  }

  /** Indices of the `ATTRACTED` filaments whose feet are closest to `angle`. */
  private nearestTo(angle: number): Set<number> {
    const order = this.filaments
      .map((f, i) => ({ i, d: Math.abs(angleDelta(f.angle, angle)) }))
      .sort((a, b) => a.d - b.d);
    return new Set(order.slice(0, ATTRACTED).map((o) => o.i));
  }

  protected draw(): void {
    this.drawGlass();
    for (const f of this.filaments) this.drawFilament(f);
    this.drawElectrode();
    this.drawRim();
  }

  private drawGlass(): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.cx, this.cy, this.coreR, this.cx, this.cy, this.globeR);
    g.addColorStop(0, 'rgba(76,29,149,0.42)');
    g.addColorStop(0.7, 'rgba(59,7,100,0.34)');
    g.addColorStop(1, 'rgba(30,7,60,0.22)');

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.globeR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /**
   * One arc, in two passes: a wide dim halo, then a thin hot core on top of it.
   *
   * Cheaper than a shadow blur and it does not smear the rest of the frame, which
   * matters on a window that is transparent everywhere the toy is not.
   */
  private drawFilament(f: Filament): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';

    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (let i = 0; i < SEGMENTS; i++) {
        const p = this.filamentPoint(f, i / (SEGMENTS - 1));
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      if (pass === 0) {
        ctx.strokeStyle = `rgba(168,85,247,${0.3 * f.bright})`;
        ctx.lineWidth = this.globeR * 0.075 * f.bright;
      } else {
        ctx.strokeStyle = `rgba(250,235,255,${0.55 + 0.45 * f.bright})`;
        ctx.lineWidth = Math.max(0.8, this.globeR * 0.016 * f.bright);
      }
      ctx.stroke();
    }

    // The bloom where the arc meets the glass. It is the brightest thing on a real globe
    // and the part a finger chases.
    const end = this.filamentPoint(f, 1);
    const r = this.globeR * 0.16 * f.bright;
    const glow = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, r);
    glow.addColorStop(0, `rgba(255,240,255,${0.55 * f.bright})`);
    glow.addColorStop(1, 'rgba(192,132,252,0)');
    ctx.beginPath();
    ctx.arc(end.x, end.y, r, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }

  /** A point along an arc. `t` runs 0 at the electrode to 1 at the glass. */
  private filamentPoint(f: Filament, t: number): { x: number; y: number } {
    const r = this.coreR + (this.globeR - this.coreR) * t;
    // Zero at both ends, fattest nearer the electrode - the shape a real arc takes,
    // and the reason the ends stay pinned however wildly the middle moves.
    const envelope = Math.sin(t * Math.PI) * (0.55 + 0.45 * (1 - t));
    const wobble =
      Math.sin(f.seed + t * 7.5 + this.time * 5.5) * 0.6 +
      Math.sin(f.seed * 1.7 + t * 15 - this.time * 3.1) * 0.3;
    const a = f.angle + wobble * envelope * f.amp;
    return { x: this.cx + Math.cos(a) * r, y: this.cy + Math.sin(a) * r };
  }

  private drawElectrode(): void {
    const ctx = this.ctx;
    const pulse = 1 + Math.sin(this.time * 7) * 0.06;
    const r = this.coreR * pulse;

    const halo = ctx.createRadialGradient(this.cx, this.cy, r * 0.4, this.cx, this.cy, r * 2.6);
    halo.addColorStop(0, 'rgba(233,213,255,0.55)');
    halo.addColorStop(1, 'rgba(168,85,247,0)');
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r * 2.6, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    const core = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, r);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.6, '#f5d0fe');
    core.addColorStop(1, '#a855f7');
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();
  }

  /** Glass edge and a specular streak, which is what makes the sphere read as glass. */
  private drawRim(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.globeR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(216,180,254,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.globeR * 0.93, Math.PI * 1.15, Math.PI * 1.55);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = this.globeR * 0.05;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /** Hover is the interaction - a plasma globe you have to click would be a button. */
  override onPointerMove(x: number, y: number): void {
    this.pointer = { x, y };
    this.pointerAge = 0;
  }

  override onPointerDown(x: number, y: number): void {
    this.onPointerMove(x, y);
  }
}

/** Shortest signed way round from `a` to `b`, in radians. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
