import { rasp } from '../audio';
import { CanvasWidget } from './types';

/**
 * The buzz wire.
 *
 * A length of wire bent into a course, a ring threaded onto it, and the whole toy is not
 * letting one touch the other. It runs the ring along by itself, weaving well inside the
 * tolerance and never grounding out; take the ring and it is yours until you reach the far
 * post, or until three touches have spent the lives you get.
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
 * Reaching a post lays the next course on the ladder: a dozen of them, five shapes
 * crossed with three grades, arranged so the difficulty cycles easy, medium, hard rather
 * than climbing to a wall. A grade is a wider swing, more bends and a tighter ring, and the
 * ring changing size is the part you actually read - it says how much room you have
 * without a word about it. The ladder walks on under autopilot too, which is how the toy
 * shows what it has while nobody is holding it.
 *
 * The course is bent afresh every time. A buzz wire you have learnt by heart is a picture.
 */

/** Layout, as fractions of the box's square. */
const WIRE_X0 = 0.13;
const WIRE_X1 = 0.87;
/** The height the wire leaves and returns to, which is where the posts stand. */
const WIRE_Y = 0.5;
const WIRE_HALF = 0.009;
/** How far off centre a medium course swings. A grade scales it; see `GRADES`. */
const BEND = 0.19;
/** How much of a wave course's swing is the quick ripple rather than the slow shape. */
const RIPPLE = 0.28;
/**
 * How much of each end is spent meeting the post.
 *
 * Every shape is faded in and out over this much of the course, which is what makes the
 * wire leave and meet the posts level rather than at an angle - a course that starts
 * already climbing has no start. A fade at the ends rather than a sine window over the
 * whole course, because a window that thin in the middle would flatten a staircase back
 * into a wave and there would be no point having both.
 */
const EDGE = 0.14;

const RING_HOLE = 0.045;
/** How much metal the ring is made of. The hole varies by grade; this does not. */
const RING_THICK = 0.019;
const HANDLE_LEN = 0.07;
/** How near the ring a press has to land to take hold of it. */
const GRAB = 0.12;

const POST_W = 0.024;
const POST_H = 0.12;
const LAMP_Y = 0.135;
const LAMP_R = 0.032;
const LIFE_R = 0.017;
const LIFE_GAP = 0.062;
const LIFE_X = 0.87;
const LABEL_X = 0.13;
const LABEL_Y = 0.105;
const GRADE_Y = 0.165;

/** Straight segments the course is cut into. Enough that the bends read as curves. */
const SAMPLES = 160;
/** How much of the course either side of the ring is searched for the nearest point. */
const SEARCH = 0.12;

/** How far into the tolerance the autopilot dares weave. */
const AUTO_WOBBLE = 0.66;

/** Touches a run survives. The third one ends it. */
const LIVES = 3;

/** Seconds the buzz is held before the ring is sent back to the start. */
const BUZZ_SECONDS = 0.7;
/** Seconds the last touch of a run is held, which is longer because it is an ending. */
const FAIL_SECONDS = 1.6;
/** Seconds a finished course is held, lamp lit, before the next one is bent. */
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

type Difficulty = 'easy' | 'medium' | 'hard';
type Pattern = 'waves' | 'zigzag' | 'bumps' | 'steps' | 'coil';

interface Level {
  pattern: Pattern;
  difficulty: Difficulty;
}

/**
 * The ladder: four laps of easy, medium, hard, with the five shapes dealt across them.
 *
 * The grades cycle rather than climb. A ladder that only climbed would spend its last
 * rungs unplayable and its first ones dull, and this toy is on screen for fifteen seconds
 * at a stretch - whoever picks the ring up joins wherever the demo has got to, so every
 * rung has to be worth arriving on. Cycling also puts an easy course directly after a hard
 * one, which is the only place the difference between them can actually be felt.
 *
 * Every shape appears at more than one grade, which is the other half of it: a pattern
 * only ever seen easy is a pattern nobody finds out they are bad at.
 */
export const LEVELS: Level[] = [
  { pattern: 'waves', difficulty: 'easy' },
  { pattern: 'zigzag', difficulty: 'medium' },
  { pattern: 'bumps', difficulty: 'hard' },
  { pattern: 'steps', difficulty: 'easy' },
  { pattern: 'coil', difficulty: 'medium' },
  { pattern: 'zigzag', difficulty: 'hard' },
  { pattern: 'bumps', difficulty: 'easy' },
  { pattern: 'waves', difficulty: 'medium' },
  { pattern: 'steps', difficulty: 'hard' },
  { pattern: 'coil', difficulty: 'easy' },
  { pattern: 'bumps', difficulty: 'medium' },
  { pattern: 'coil', difficulty: 'hard' },
];

interface Grade {
  /** Multiplies the swing off centre, so a harder course covers more ground. */
  swing: number;
  /** Multiplies how many bends the shape fits into the course. */
  bends: number;
  /** Multiplies the ring's hole, which is the tolerance and the picture of it at once. */
  clearance: number;
  /** Courses per second under autopilot. */
  speed: number;
  colour: string;
}

const GRADES: Record<Difficulty, Grade> = {
  easy: { swing: 0.6, bends: 0.65, clearance: 1.3, speed: 0.17, colour: '134,239,172' },
  medium: { swing: 1, bends: 1, clearance: 1, speed: 0.2, colour: '253,224,71' },
  hard: { swing: 1.3, bends: 1.5, clearance: 0.76, speed: 0.24, colour: '248,113,113' },
};

/**
 * A course's character, as an offset from the centre line over s in [0,1].
 *
 * Answers inside [-1,1] and nothing else: the swing, the fade at the posts and the pixels
 * are all the caller's business, so a shape is only ever saying what kind of course it is.
 */
type Shape = (s: number) => number;

interface Point {
  x: number;
  y: number;
}

/** A point on the wire, carrying the unit normal there. */
interface Spot extends Point {
  nx: number;
  ny: number;
}

type Phase = 'run' | 'buzz' | 'failed' | 'arrived';
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
  /** Where on the ladder this is, as an index into `LEVELS`. */
  private level = 0;
  /** Touches left in this run. Only a hand can spend one. */
  private lives = LIVES;
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
    this.level = 0;
    this.lives = LIVES;
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

  private get grade(): Grade {
    return GRADES[LEVELS[this.level]!.difficulty]!;
  }

  /** The ring's hole, as a fraction of the square. The grade is what varies it. */
  private get hole(): number {
    return RING_HOLE * this.grade.clearance;
  }

  /** The tolerance in pixels - how far the ring's centre may stray before it grounds out. */
  private get touch(): number {
    return (this.hole - WIRE_HALF) * this.size;
  }

  /**
   * Pick a shape, with the dice in it.
   *
   * The pattern says what kind of course this is and the grade says how much of it there
   * is; everything else - which way up, where the bends fall, how many - is drawn fresh,
   * so the same rung of the ladder is never the same course twice.
   */
  private shape(pattern: Pattern, bends: number): Shape {
    const flip = Math.random() < 0.5 ? -1 : 1;
    const phase = Math.random() * Math.PI * 2;
    const rate = (base: number) => Math.max(1, Math.round(base * bends));

    if (pattern === 'zigzag') {
      // A triangle wave: the straights are easy and every peak is a corner you have to
      // take the ring round without letting it drift wide.
      const k = rate(2.5);
      return (s) => flip * (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * k * s + phase));
    }

    if (pattern === 'bumps') {
      // Round-topped humps either side of the line, steep where they cross it. The
      // opposite problem to the zigzag: nothing to line up on, and no flat to rest in.
      const k = rate(3);
      return (s) => {
        const u = Math.sin(Math.PI * k * s + phase);
        return flip * Math.sign(u) * Math.sqrt(Math.abs(u));
      };
    }

    if (pattern === 'steps') {
      // A staircase: flat runs joined by risers you have to cross square, since a riser
      // taken at an angle is the whole tolerance spent on one move. Counted in risers
      // rather than treads, so the last climb lands exactly at the top rather than a step
      // past it.
      const n = Math.max(3, rate(4));
      return (s) => {
        const u = Math.min(s, 1 - 1e-6) * n;
        const step = Math.floor(u);
        const across = smoothstep((u - step - 0.55) / 0.3);
        return flip * ((2 * (step + across)) / n - 1);
      };
    }

    if (pattern === 'coil') {
      // A chirp - the bends tighten as the course goes on, so the far half of it is a
      // different problem from the near half and the run cannot be taken at one pace.
      const f0 = 0.7 * bends;
      const f1 = 2.6 * bends;
      return (s) =>
        flip * Math.sin(2 * Math.PI * (f0 * s + ((f1 - f0) * s * s) / 2) + phase) * (1 - 0.3 * s);
    }

    // Waves: a slow shape to follow with a quicker ripple riding on it, which is the
    // course this toy started with and still the one it opens on.
    const k1 = rate(2.5);
    const k2 = k1 + 2 + Math.floor(Math.random() * 2);
    const p2 = Math.random() * Math.PI * 2;
    return (s) =>
      flip *
      ((1 - RIPPLE) * Math.sin(k1 * Math.PI * s + phase) +
        RIPPLE * Math.sin(k2 * Math.PI * s + p2));
  }

  /** Bend the course for the rung the ladder is on. */
  private bendWire(): void {
    const grade = this.grade;
    const shape = this.shape(LEVELS[this.level]!.pattern, grade.bends);
    const swing = BEND * grade.swing;

    this.wire = [];
    this.arc = [];
    let total = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const s = i / SAMPLES;
      const point = {
        x: this.fx(WIRE_X0 + (WIRE_X1 - WIRE_X0) * s),
        y: this.fy(WIRE_Y + swing * fade(s) * shape(s)),
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
    if (this.phase === 'failed') {
      this.timer -= dt;
      if (this.timer <= 0) this.restart();
      return;
    }
    if (this.phase === 'arrived') {
      this.timer -= dt;
      if (this.timer <= 0) this.nextCourse();
      return;
    }
    if (this.dragging || this.wait > 0) return;
    this.autopilot(dt);
  }

  /**
   * Whether the run belongs to a player, and whether the cycle should wait for them.
   *
   * Asked for the moment the ring is taken and given back on the first of three endings:
   * the far post reached, the last life spent, or a course left alone long enough that
   * whoever started it is plainly not coming back. A hand still on the ring counts as
   * touching it, so stopping to steady yourself halfway does not run the clock out.
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
    this.pos += this.dir * this.grade.speed * this.length * dt;
    // Weaving inside the tolerance rather than running down the middle: the near miss is
    // the toy. Two periods, so it does not read as a metronome, and a fraction of the
    // tolerance rather than a number of pixels, so the autopilot cannot ground itself out
    // however the course came out or however tight the grade holds the ring.
    const sway = Math.sin(this.time * 2.1) * 0.7 + Math.sin(this.time * 3.7 + 1.2) * 0.3;
    this.offset = sway * AUTO_WOBBLE * this.touch;
    if (this.pos < this.length && this.pos > 0) return;
    this.pos = clamp(this.pos, 0, this.length);
    this.arrive();
  }

  /** The ring at the far post - the end of a course, whoever was steering. */
  private arrive(): void {
    if (this.dragging) {
      this.wait = RESUME_DELAY;
      // Only for a hand on the ring. The autopilot finishes a course every few seconds all
      // day, and a toy that chimed at nobody while you worked is a toy you switch off - so
      // this one sound in the widget is the one that answers to who was steering.
      rasp.chime();
    }
    this.phase = 'arrived';
    this.timer = ARRIVE_SECONDS;
    this.lamp = 'good';
    this.dragging = false;
    this.offset = 0;
    this.release();
  }

  /**
   * The next rung, bent while the ring rests on the post it arrived at.
   *
   * Which is the only moment a course may be replaced: both ends of every course are the
   * same two posts, so a ring sitting on one is still threaded on whatever comes next -
   * anywhere else along the wire it would be a ring that changed wires under your hand.
   */
  private nextCourse(): void {
    const fromFar = this.pos >= this.length / 2;
    this.level = (this.level + 1) % LEVELS.length;
    this.bendWire();
    this.dir = fromFar ? -1 : 1;
    this.pos = fromFar ? this.length : 0;
    this.offset = 0;
    this.phase = 'run';
    this.lamp = 'off';
  }

  /**
   * Contact. A life, and the ring back to the start of the current direction.
   *
   * Losing the ring is deliberately most of the penalty: you have to reach for it again,
   * which is a beat to be annoyed in and nothing more. What the lives add is a run worth
   * being careful in - three touches and the ladder goes back to its first rung, so the
   * fifth course is somewhere you got to rather than somewhere you waited for.
   */
  private buzz(side: number): void {
    this.lives -= 1;
    this.lamp = 'bad';
    // Pinned against the wire rather than snapped back onto it: the picture has to show
    // what you did, for as long as the buzz lasts.
    this.offset = side * this.touch;
    this.dragging = false;
    this.wait = Math.max(this.wait, RESUME_DELAY);

    if (this.lives > 0) {
      this.phase = 'buzz';
      this.timer = BUZZ_SECONDS;
      rasp.buzz();
      return;
    }

    // The last one is held longer and sounds longer, because it is the end of the run and
    // not another go - the same buzz twice would say nothing about which was which.
    this.phase = 'failed';
    this.timer = FAIL_SECONDS;
    rasp.buzz(FAIL_SECONDS);
    this.release();
  }

  private backToStart(): void {
    this.pos = this.dir > 0 ? 0 : this.length;
    this.offset = 0;
    this.phase = 'run';
    this.lamp = 'off';
    this.wait = Math.max(this.wait, RESUME_DELAY);
  }

  /** Lives spent: back to the first rung, with the lives to climb it again. */
  private restart(): void {
    this.level = 0;
    this.lives = LIVES;
    this.bendWire();
    this.dir = 1;
    this.pos = 0;
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
   *
   * It is a fraction of the arc length rather than a number of pixels, which is what keeps
   * it honest across the ladder: a coiled course is longer than a gentle one and its folds
   * are closer together, so the window has to shrink with them.
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
    // A fresh hand gets a fresh three. Lives belong to the run rather than to the toy: the
    // autopilot never spends one, and inheriting what the last person spent would be a
    // punishment for arriving late.
    if (!this.engaged) this.lives = LIVES;
    // Even a reach that catches nothing holds the autopilot off, so the ring never sets
    // off from under a hand that is already going for it.
    this.engaged = true;
    this.sinceTouch = 0;
    this.setHold(true);
    this.wait = RESUME_DELAY;
    if (this.phase === 'buzz' || this.phase === 'failed') return;

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
    this.drawLevel();
    this.drawLives();
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
    if (this.phase !== 'buzz' && this.phase !== 'failed') return;
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

  /**
   * Which rung this is, and how hard it is.
   *
   * The grade is written out as well as coloured, because the ring's size says the same
   * thing and a player who has only ever seen one course has nothing to compare it to.
   */
  private drawLevel(): void {
    const ctx = this.ctx;
    const x = this.fx(LABEL_X);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226,232,240,0.85)';
    ctx.font = `600 ${Math.round(this.size * 0.045)}px system-ui, sans-serif`;
    ctx.fillText(`level ${this.level + 1}`, x, this.fy(LABEL_Y));

    ctx.fillStyle = `rgba(${this.grade.colour},0.9)`;
    ctx.font = `${Math.round(this.size * 0.04)}px system-ui, sans-serif`;
    ctx.fillText(LEVELS[this.level]!.difficulty, x, this.fy(GRADE_Y));
    ctx.restore();
  }

  /** The lives, as rings: what you are holding, three times over, and then unlit. */
  private drawLives(): void {
    const ctx = this.ctx;
    const r = LIFE_R * this.size;
    ctx.lineWidth = Math.max(1, this.size * 0.008);
    for (let i = 0; i < LIVES; i++) {
      const spent = i >= this.lives;
      ctx.beginPath();
      ctx.arc(this.fx(LIFE_X - i * LIFE_GAP), this.fy(LAMP_Y), r, 0, Math.PI * 2);
      ctx.strokeStyle = spent ? 'rgba(148,163,184,0.25)' : 'rgba(226,232,240,0.85)';
      ctx.stroke();
    }
  }

  private drawRing(): void {
    const ctx = this.ctx;
    const spot = this.sample(this.pos);
    const cx = spot.x + spot.nx * this.offset;
    const cy = spot.y + spot.ny * this.offset;
    const thick = RING_THICK * this.size;
    const mid = this.hole * this.size + thick / 2;
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

    if (this.phase === 'buzz' || this.phase === 'failed') {
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

function smoothstep(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

/** How much of a shape is showing at s: nothing at the posts, all of it in between. */
function fade(s: number): number {
  return smoothstep(Math.min(s, 1 - s) / EDGE);
}
