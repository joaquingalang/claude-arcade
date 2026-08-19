import { rasp } from '../audio';
import { CanvasWidget } from './types';

/**
 * The buzz wire.
 *
 * A length of wire bent into a course, a ring threaded onto it, and the whole toy is not
 * letting one touch the other. It runs the ring along by itself, weaving well inside the
 * tolerance and never grounding out; take the ring and it is yours until you reach the far
 * post or touch the wire and get sent back to the start.
 *
 * The ring is *threaded*, and that is the one thing this has to get right. Its centre is
 * never the pointer: it is the nearest point on the wire, pushed sideways by however far
 * the hand has strayed and clamped at the tolerance. So the ring cannot come off the
 * course, a hand that jerks away drags it against the wire rather than teleporting it off,
 * and - the reason the search for that nearest point is windowed to the stretch either
 * side of where the ring already is - a hand crossing a fold of the course cannot snap the
 * ring to the far side of the fold, which would be the ring coming off the wire by another
 * name.
 *
 * The course is bent afresh each run. A buzz wire you have learnt by heart is a picture.
 */

/** Layout, as fractions of the box's square. */
const WIRE_X0 = 0.13;
const WIRE_X1 = 0.87;
/** The height the wire leaves and returns to, which is where the posts stand. */
const WIRE_Y = 0.5;
const WIRE_HALF = 0.009;
/** How far off centre the course may bend. The two terms sum, so this is the whole swing. */
const BEND_MAIN = 0.15;
const BEND_DETAIL = 0.055;

const RING_HOLE = 0.045;
const RING_OUTER = 0.064;
const HANDLE_LEN = 0.07;
/** How far the ring's centre may stray before the hole meets the wire. The tolerance. */
const TOUCH = RING_HOLE - WIRE_HALF;
/** How near the ring a press has to land to take hold of it. */
const GRAB = 0.12;

const POST_W = 0.024;
const POST_H = 0.12;
const LAMP_Y = 0.135;
const LAMP_R = 0.032;

/** Straight segments the course is cut into. Enough that the bends read as curves. */
const SAMPLES = 160;
/** How much of the course either side of the ring is searched for the nearest point. */
const SEARCH = 0.12;

/** Courses per second under autopilot, and how far into the tolerance it dares weave. */
const AUTO_SPEED = 0.2;
const AUTO_WOBBLE = 0.66;

/** Seconds the buzz is held before the ring is sent back to the start. */
const BUZZ_SECONDS = 0.7;
/** Seconds a finished course is held, lamp lit, before the trip back. */
const ARRIVE_SECONDS = 1.1;
/**
 * How long after you let go before the autopilot picks the ring up again.
 *
 * Long enough to reposition your hand without it setting off without you, short enough
 * that a toy you have wandered away from is moving again by the time you look back.
 */
const RESUME_DELAY = 2.4;
/**
 * How long a course someone started stays theirs after they stop touching it.
 *
 * The release valve on the hold: a run is worth finishing, so the cycle waits for a
 * player, but "waiting for a player" has to end where the honest reading is that they
 * walked away.
 */
const ABANDON_SECONDS = 15;

interface Point {
  x: number;
  y: number;
}

/** A point on the wire, carrying the unit normal there. */
interface Spot extends Point {
  nx: number;
  ny: number;
}

type Phase = 'run' | 'buzz' | 'arrived';
type Lamp = 'off' | 'good' | 'bad';

export class BuzzWire extends CanvasWidget {
  /** The course, as points, with the arc length reached at each one alongside. */
  private wire: Point[] = [];
  private arc: number[] = [];
  private length = 0;
  /** How far along the course the ring is, in pixels of arc length. */
  private pos = 0;
  /** How far off the wire the ring is being held, signed, in pixels. */
  private offset = 0;
  /** Which end the ring is headed for: 1 for the far post, -1 for the near one. */
  private dir: 1 | -1 = 1;
  private phase: Phase = 'run';
  private lamp: Lamp = 'off';
  private timer = 0;
  /** Seconds still owed to the player before the autopilot takes the ring back. */
  private wait = 0;
  private time = 0;
  private dragging = false;
  /** Whether this run belongs to a player rather than to the autopilot. */
  private engaged = false;
  private sinceTouch = 0;

  protected init(): void {
    this.bendWire();
    this.pos = 0;
    this.offset = 0;
    this.dir = 1;
    this.phase = 'run';
    this.lamp = 'off';
    this.timer = 0;
    this.wait = 0;
    this.time = 0;
    this.dragging = false;
    this.engaged = false;
    this.sinceTouch = 0;
  }

  /** The tolerance in pixels - how far the ring's centre may stray before it grounds out. */
  private get touch(): number {
    return TOUCH * this.size;
  }

  /**
   * Bend a fresh course.
   *
   * Two sine terms of different periods, so the wire has both a shape to follow and detail
   * to catch you out on. Both are windowed by a half sine, which is what makes the wire
   * leave and meet the posts level rather than at an angle - a course that starts already
   * climbing has no start.
   */
  private bendWire(): void {
    const k1 = 2 + Math.floor(Math.random() * 2);
    const k2 = k1 + 2 + Math.floor(Math.random() * 2);
    const p1 = Math.random() * Math.PI * 2;
    const p2 = Math.random() * Math.PI * 2;
    const a1 = BEND_MAIN * (0.75 + Math.random() * 0.25);
    const a2 = BEND_DETAIL * (0.5 + Math.random() * 0.5);

    this.wire = [];
    this.arc = [];
    let total = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const s = i / SAMPLES;
      const bend = a1 * Math.sin(k1 * Math.PI * s + p1) + a2 * Math.sin(k2 * Math.PI * s + p2);
      const point = {
        x: this.fx(WIRE_X0 + (WIRE_X1 - WIRE_X0) * s),
        y: this.fy(WIRE_Y + Math.sin(Math.PI * s) * bend),
      };
      if (i > 0) {
        const prev = this.wire[i - 1]!;
        total += Math.hypot(point.x - prev.x, point.y - prev.y);
      }
      this.wire.push(point);
      this.arc.push(total);
    }
    this.length = total;
  }

  protected update(dt: number): void {
    this.time += dt;
    this.trackPlayer(dt);
    if (this.wait > 0) this.wait = Math.max(0, this.wait - dt);

    if (this.phase === 'buzz') {
      this.timer -= dt;
      if (this.timer <= 0) this.backToStart();
      return;
    }
    if (this.phase === 'arrived') {
      this.timer -= dt;
      if (this.timer <= 0) this.turnAround();
      return;
    }
    if (this.dragging || this.wait > 0) return;
    this.autopilot(dt);
  }

  /**
   * Whether the run belongs to a player, and whether the cycle should wait for them.
   *
   * Asked for the moment the ring is taken and given back on the first of two endings: the
   * far post reached, or a course left alone long enough that whoever started it is plainly
   * not coming back. A hand still on the ring counts as touching it, so stopping to steady
   * yourself halfway does not run the clock out.
   *
   * Autoplay never asks. A toy nobody is touching answers to the cycle clock like the rest
   * of them, which is the whole reason this is a hold rather than a game's open run.
   */
  private trackPlayer(dt: number): void {
    if (!this.engaged) return;
    this.sinceTouch = this.dragging ? 0 : this.sinceTouch + dt;
    if (this.sinceTouch < ABANDON_SECONDS) return;
    this.release();
  }

  private release(): void {
    if (!this.engaged) return;
    this.engaged = false;
    this.setHold(false);
  }

  private autopilot(dt: number): void {
    this.pos += this.dir * AUTO_SPEED * this.length * dt;
    // Weaving inside the tolerance rather than running down the middle: the near miss is
    // the toy. Two periods, so it does not read as a metronome, and a fraction of the
    // tolerance rather than a number of pixels, so the autopilot cannot ground itself out
    // however the course came out.
    const sway = Math.sin(this.time * 2.1) * 0.7 + Math.sin(this.time * 3.7 + 1.2) * 0.3;
    this.offset = sway * AUTO_WOBBLE * this.touch;
    if (this.pos < this.length && this.pos > 0) return;
    this.pos = clamp(this.pos, 0, this.length);
    this.arrive();
  }

  /** The ring at the far post - the end of a course, whoever was steering. */
  private arrive(): void {
    if (this.dragging) this.wait = RESUME_DELAY;
    this.phase = 'arrived';
    this.timer = ARRIVE_SECONDS;
    this.lamp = 'good';
    this.dragging = false;
    this.offset = 0;
    this.release();
  }

  private turnAround(): void {
    this.dir = this.pos >= this.length / 2 ? -1 : 1;
    this.phase = 'run';
    this.lamp = 'off';
  }

  /**
   * Contact. Back to the start of the current direction, and the ring is dropped.
   *
   * Dropping it is the whole penalty, and it is deliberately a small one: you have to
   * reach for the ring again, which is a beat to be annoyed in and nothing more. A toy
   * that punished this properly would be a toy nobody touches twice.
   */
  private buzz(side: number): void {
    this.phase = 'buzz';
    this.timer = BUZZ_SECONDS;
    this.lamp = 'bad';
    // Pinned against the wire rather than snapped back onto it: the picture has to show
    // what you did, for as long as the buzz lasts.
    this.offset = side * this.touch;
    this.dragging = false;
    this.wait = Math.max(this.wait, RESUME_DELAY);
    rasp.buzz();
  }

  private backToStart(): void {
    this.pos = this.dir > 0 ? 0 : this.length;
    this.offset = 0;
    this.phase = 'run';
    this.lamp = 'off';
    this.wait = Math.max(this.wait, RESUME_DELAY);
  }

  /** Where the ring is: a point on the wire, pushed out by however hard it is pulled. */
  private ringCentre(): Point {
    const spot = this.sample(this.pos);
    return { x: spot.x + spot.nx * this.offset, y: spot.y + spot.ny * this.offset };
  }

  /** The segment containing an arc length, by bisection over the cumulative lengths. */
  private segment(at: number): number {
    const d = clamp(at, 0, this.length);
    let lo = 0;
    let hi = this.wire.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.arc[mid]! <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private sample(at: number): Spot {
    const d = clamp(at, 0, this.length);
    const i = this.segment(d);
    const a = this.wire[i]!;
    const b = this.wire[i + 1]!;
    const span = this.arc[i + 1]! - this.arc[i]!;
    const t = span > 0 ? (d - this.arc[i]!) / span : 0;
    const dx = (b.x - a.x) / (span || 1);
    const dy = (b.y - a.y) / (span || 1);
    // The normal is the tangent turned a quarter turn: sideways off the wire is the only
    // direction a threaded ring can be pulled in that means anything.
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: -dy, ny: dx };
  }

  /**
   * The nearest point on the course to a pointer, searched only near the ring.
   *
   * The window is not an optimisation. Unwindowed, a hand held above a fold of the course
   * would find its nearest point on the far side of the fold and the ring would jump
   * there - a ring hopping across the wire rather than sliding along it. Coordinates from
   * outside the box land here too and answer with a distance far past the tolerance, which
   * is exactly right: yanking the ring off the board is touching the wire.
   */
  private nearest(px: number, py: number): { at: number; offset: number } {
    const span = SEARCH * this.length;
    const lo = this.segment(this.pos - span);
    const hi = this.segment(this.pos + span);
    let at = this.pos;
    let offset = this.offset;
    let best = Infinity;

    for (let i = lo; i <= hi; i++) {
      const a = this.wire[i]!;
      const b = this.wire[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1) : 0;
      const cx = a.x + dx * t;
      const cy = a.y + dy * t;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist >= best) continue;
      best = dist;
      // Read off the arc table rather than off sqrt(len2), which is the same length by a
      // different route: at the far post the two disagree in the last bit, and `at` a
      // hair short of `length` is a course that cannot be finished by hand.
      at = this.arc[i]! + t * (this.arc[i + 1]! - this.arc[i]!);
      // Signed by which side of the wire the hand is on, so the ring is drawn where the
      // hand actually is and a buzz pins it against the right edge of the hole.
      offset = dist * (Math.sign(dx * (py - a.y) - dy * (px - a.x)) || 1);
    }
    return { at, offset };
  }

  override onPointerDown(x: number, y: number): void {
    // Even a reach that catches nothing holds the autopilot off, so the ring never sets
    // off from under a hand that is already going for it.
    this.engaged = true;
    this.sinceTouch = 0;
    this.setHold(true);
    this.wait = RESUME_DELAY;
    if (this.phase === 'buzz') return;

    const ring = this.ringCentre();
    if (Math.hypot(x - ring.x, y - ring.y) > GRAB * this.size) return;

    // Lifting the ring off a post starts the course that leads away from it.
    if (this.pos <= 0) this.dir = 1;
    else if (this.pos >= this.length) this.dir = -1;
    this.phase = 'run';
    this.lamp = 'off';
    this.dragging = true;
  }

  override onPointerMove(x: number, y: number): void {
    if (!this.dragging) return;
    this.sinceTouch = 0;

    const hit = this.nearest(x, y);
    this.pos = hit.at;
    if (Math.abs(hit.offset) >= this.touch) {
      this.buzz(Math.sign(hit.offset) || 1);
      return;
    }
    this.offset = hit.offset;
    if ((this.dir > 0 && this.pos >= this.length) || (this.dir < 0 && this.pos <= 0)) this.arrive();
  }

  override onPointerUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.sinceTouch = 0;
    this.wait = RESUME_DELAY;
  }

  /** The square this is laid out in, centred in whatever box the window gave us. */
  private fx(fraction: number): number {
    return (this.width - this.size) / 2 + fraction * this.size;
  }

  private fy(fraction: number): number {
    return (this.height - this.size) / 2 + fraction * this.size;
  }

  protected draw(): void {
    this.drawPosts();
    this.drawWire();
    this.drawLamp();
    this.drawRing();
  }

  private drawPosts(): void {
    const ctx = this.ctx;
    const w = POST_W * this.size;
    for (const end of [this.wire[0]!, this.wire[this.wire.length - 1]!]) {
      ctx.fillStyle = 'rgba(100,116,139,0.7)';
      ctx.fillRect(end.x - w / 2, end.y, w, POST_H * this.size);
      ctx.beginPath();
      ctx.arc(end.x, end.y, w * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(203,213,225,0.85)';
      ctx.fill();
    }
  }

  private drawWire(): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineWidth = WIRE_HALF * 2 * this.size;

    ctx.strokeStyle = 'rgba(148,163,184,0.4)';
    this.trace(0, this.length);

    // The stretch already covered, which is the only score this keeps.
    ctx.strokeStyle = 'rgba(125,211,252,0.9)';
    this.trace(this.dir > 0 ? 0 : this.pos, this.dir > 0 ? this.pos : this.length);

    // A grounded wire lights end to end. That is what the circuit does, and it says the
    // buzz was yours rather than something that happened near you.
    if (this.phase !== 'buzz') return;
    ctx.strokeStyle = 'rgba(248,113,113,0.9)';
    this.trace(0, this.length);
  }

  /** Path the course between two arc lengths, the ends landing exactly rather than on a sample. */
  private trace(from: number, to: number): void {
    const ctx = this.ctx;
    const a = this.sample(from);
    const b = this.sample(to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (let i = 0; i < this.wire.length; i++) {
      const at = this.arc[i]!;
      if (at <= from || at >= to) continue;
      ctx.lineTo(this.wire[i]!.x, this.wire[i]!.y);
    }
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  /**
   * The lamp, which is what makes this playable in silence.
   *
   * It carries the same two facts the buzz does - you touched it, you got there - so sound
   * off costs the toy nothing.
   */
  private drawLamp(): void {
    const ctx = this.ctx;
    const x = this.fx(0.5);
    const y = this.fy(LAMP_Y);
    const r = LAMP_R * this.size;
    const lit = this.lamp !== 'off';
    const colour = this.lamp === 'bad' ? '248,113,113' : '134,239,172';

    if (lit) {
      ctx.beginPath();
      ctx.arc(x, y, r * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colour},0.16)`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = lit ? `rgba(${colour},0.9)` : 'rgba(148,163,184,0.2)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, this.size * 0.004);
    ctx.strokeStyle = 'rgba(203,213,225,0.35)';
    ctx.stroke();
  }

  private drawRing(): void {
    const ctx = this.ctx;
    const spot = this.sample(this.pos);
    const cx = spot.x + spot.nx * this.offset;
    const cy = spot.y + spot.ny * this.offset;
    const mid = ((RING_HOLE + RING_OUTER) / 2) * this.size;
    const thick = (RING_OUTER - RING_HOLE) * this.size;
    // The handle trails the hand: out along the normal, on the side the ring is pulled.
    const side = this.offset >= 0 ? 1 : -1;

    ctx.lineCap = 'round';
    ctx.lineWidth = thick * 0.85;
    ctx.strokeStyle = 'rgba(120,113,108,0.9)';
    ctx.beginPath();
    ctx.moveTo(cx + spot.nx * side * mid, cy + spot.ny * side * mid);
    ctx.lineTo(
      cx + spot.nx * side * (mid + HANDLE_LEN * this.size),
      cy + spot.ny * side * (mid + HANDLE_LEN * this.size),
    );
    ctx.stroke();

    if (this.phase === 'buzz') {
      ctx.beginPath();
      ctx.arc(cx, cy, mid * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(248,113,113,0.18)';
      ctx.fill();
    }

    ctx.lineWidth = thick;
    ctx.strokeStyle = this.dragging ? 'rgba(253,224,71,0.95)' : 'rgba(226,232,240,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, mid, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
