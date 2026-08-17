import { knock } from '../audio';
import { CanvasWidget } from './types';

/**
 * The Tower of Hanoi.
 *
 * It solves itself a disc at a time, and when the stack lands complete it picks another
 * post and sets off again - a solved tower is the setup for the next trip, so the puzzle
 * having an ending costs nothing here. Grab a disc and it hands over; let go and, after a
 * beat, it carries on from wherever you left it, mistakes included.
 *
 * That last part is why the solver is a general one rather than the textbook recursion.
 * `hanoi(n, from, to, spare)` knows the move list for a *tidy* tower and has nothing to say
 * about a board someone has been shuffling by hand. `nextMove` asks the one question that
 * has an answer from any legal position - which disc moves next, given where everything
 * currently is - so the autopilot and the pointer can share one board with no reset
 * between them.
 */

const DISC_COUNT = 5;
const POST_COUNT = 3;
/** Post indices sum to this, which is how the spare post is named without a lookup. */
const POST_SUM = 3;

/** Layout, as fractions of the box's square. `BASE_Y` is the surface discs rest on. */
const BASE_Y = 0.82;
const BASE_H = 0.055;
const BASE_W = 0.94;
/** Tall enough to swallow the whole tower with a disc's headroom to spare, and no more. */
const POST_H = 0.52;
const POST_W = 0.028;
/** Between post centres. Must clear `DISC_MAX_W`, or two full-width discs touch. */
const POST_GAP = 0.31;
const DISC_H = 0.085;
const DISC_MIN_W = 0.12;
const DISC_MAX_W = 0.27;
/** Height a disc is carried at while crossing - above the posts, so it clears every stack. */
const FLIGHT_Y = 0.245;

/** Seconds a move takes, and the beat between two of them. */
const MOVE_SECONDS = 0.46;
const SETTLE = 0.12;
/** A breath when the tower lands complete, before it starts the trip back. */
const SOLVED_PAUSE = 1;
/**
 * How long after you let go before it starts solving again.
 *
 * Long enough to move a second disc without the autopilot talking over you, short enough
 * that a toy you have wandered away from is moving again by the time you look back.
 */
const RESUME_DELAY = 2.4;
/**
 * How long a board someone started stays theirs after they stop touching it.
 *
 * This is the release valve on the hold, not the autopilot: the puzzle is worth finishing,
 * so the cycle waits for a player, but "waiting for a player" has to end at the point
 * where the honest reading is that they walked away.
 */
const ABANDON_SECONDS = 15;

/** Fractions of a move spent lifting and dropping; the rest is the crossing. */
const LIFT = 0.28;
const FALL = 0.28;

interface Move {
  disc: number;
  from: number;
  to: number;
}

interface Flight extends Move {
  /** 0 to 1 across the whole lift-cross-drop. */
  t: number;
}

interface Held {
  disc: number;
  from: number;
  x: number;
  y: number;
}

export class TowerOfHanoi extends CanvasWidget {
  /** Discs on each post, bottom first. A disc is its own size, 1 (smallest) to `DISC_COUNT`. */
  private posts: number[][] = [];
  /** The post the whole tower is currently headed for. */
  private goal = 0;
  private flight: Flight | null = null;
  private held: Held | null = null;
  /** Seconds still to wait before the next move starts. */
  private wait = 0;
  /** Whether this round belongs to a player rather than to the autopilot. */
  private engaged = false;
  private sinceTouch = 0;

  protected init(): void {
    this.posts = [[], [], []];
    for (let disc = DISC_COUNT; disc >= 1; disc--) this.posts[0]!.push(disc);
    this.goal = 2;
    this.flight = null;
    this.held = null;
    this.wait = SETTLE;
    this.engaged = false;
    this.sinceTouch = 0;
  }

  protected update(dt: number): void {
    this.trackPlayer(dt);

    // A disc in hand freezes the rest: two discs moving at once, one of them yours, is how
    // you end up dropping onto a post that changed underneath you.
    if (this.held) return;

    if (this.flight) {
      this.flight.t += dt / MOVE_SECONDS;
      if (this.flight.t >= 1) this.land();
      return;
    }

    this.wait -= dt;
    if (this.wait <= 0) this.launch();
  }

  /**
   * Whether the round belongs to a player, and whether the cycle should wait for them.
   *
   * The hold is asked for the moment a disc is picked up and given back on the first of
   * two endings: a tower standing complete on some post - the round is over, however it
   * got there - or a board left alone long enough that whoever started it is plainly not
   * coming back. A disc still in hand counts as touching it, so stopping to think with one
   * lifted does not run the clock out.
   *
   * Autoplay never asks. A toy nobody is touching answers to the cycle clock like the rest
   * of them, which is the whole reason this is a hold rather than a game's open run.
   */
  private trackPlayer(dt: number): void {
    if (!this.engaged) return;
    this.sinceTouch = this.held ? 0 : this.sinceTouch + dt;
    if (!this.solved() && this.sinceTouch < ABANDON_SECONDS) return;
    this.engaged = false;
    this.setHold(false);
  }

  /** A tower standing complete on one post - the end of a round, whoever played it. */
  private solved(): boolean {
    return this.posts.some((post) => post.length === DISC_COUNT);
  }

  /** Lift the next disc, or - if there is nothing left to do - choose somewhere new to go. */
  private launch(): void {
    const move = this.nextMove();
    if (!move) {
      // Solved. Stopping would leave a still picture on the desk, so it takes the tower
      // somewhere else instead: the same puzzle again, and no reset to watch.
      this.goal = (this.goal + 1 + Math.floor(Math.random() * (POST_COUNT - 1))) % POST_COUNT;
      this.wait = SOLVED_PAUSE;
      return;
    }
    this.posts[move.from]!.pop();
    this.flight = { ...move, t: 0 };
  }

  private land(): void {
    const f = this.flight!;
    this.flight = null;
    this.posts[f.to]!.push(f.disc);
    this.thud(f.disc);
    this.wait = SETTLE;
  }

  /**
   * The next move on the shortest path to `goal`, from wherever the discs happen to be.
   *
   * Walks from the largest disc down, carrying the post that disc has to end up on. One
   * already there says nothing and passes the same target to the disc above it - the
   * smaller discs simply have to gather on top of it. One that is *not* there cannot move
   * until every smaller disc is out of the way on the spare post, so it is recorded as a
   * candidate and the walk continues with that spare as the target.
   *
   * The last candidate recorded wins. Everything below it turned out to be exactly where
   * this move needs it, which is what makes the move legal, and it is the deepest debt to
   * settle first.
   *
   * Null only when no disc was ever out of place - the tower is already on `goal`.
   */
  private nextMove(): Move | null {
    let to = this.goal;
    let candidate: Move | null = null;
    for (let disc = DISC_COUNT; disc >= 1; disc--) {
      const from = this.postOf(disc);
      if (from === to) continue;
      candidate = { disc, from, to };
      to = POST_SUM - from - to;
    }
    return candidate;
  }

  /** Which post a disc sits on. Only asked while the board is at rest, so every disc is on one. */
  private postOf(disc: number): number {
    for (let i = 0; i < POST_COUNT; i++) {
      if (this.posts[i]!.includes(disc)) return i;
    }
    return this.goal;
  }

  /** One disc settling onto wood. Bigger discs land harder. */
  private thud(disc: number): void {
    knock.tick(0.45 + (disc / DISC_COUNT) * 0.55);
  }

  private px(fraction: number): number {
    return fraction * this.size;
  }

  /** The square this is laid out in, centred in whatever box the window gave us. */
  private fx(fraction: number): number {
    return (this.width - this.size) / 2 + fraction * this.size;
  }

  private fy(fraction: number): number {
    return (this.height - this.size) / 2 + fraction * this.size;
  }

  private postX(i: number): number {
    return this.fx(0.5 + (i - 1) * POST_GAP);
  }

  /** Centre height of the `level`th disc up a stack, counting from 0 at the base. */
  private slotY(level: number): number {
    return this.fy(BASE_Y - level * DISC_H - DISC_H / 2);
  }

  /**
   * Where a disc in flight is right now.
   *
   * The source and destination heights are read from the stacks rather than stored, which
   * they can be because a flying disc belongs to neither: it was popped at take-off and is
   * not pushed until it lands, so both stack heights are already the ones it cares about.
   */
  private flightPos(f: Flight): { x: number; y: number } {
    const apex = this.fy(FLIGHT_Y);
    const x0 = this.postX(f.from);
    const x1 = this.postX(f.to);
    const t = Math.min(1, f.t);

    if (t < LIFT) {
      return { x: x0, y: lerp(this.slotY(this.posts[f.from]!.length), apex, ease(t / LIFT)) };
    }
    if (t < 1 - FALL) {
      return { x: lerp(x0, x1, ease((t - LIFT) / (1 - LIFT - FALL))), y: apex };
    }
    return { x: x1, y: lerp(apex, this.slotY(this.posts[f.to]!.length), ease((t - 1 + FALL) / FALL)) };
  }

  protected draw(): void {
    this.drawBase();
    for (let i = 0; i < POST_COUNT; i++) this.drawPost(i);

    for (let i = 0; i < POST_COUNT; i++) {
      const stack = this.posts[i]!;
      for (let level = 0; level < stack.length; level++) {
        this.drawDisc(stack[level]!, this.postX(i), this.slotY(level));
      }
    }

    if (this.flight) {
      const p = this.flightPos(this.flight);
      this.drawDisc(this.flight.disc, p.x, p.y);
    }
    if (this.held) {
      // Clamped rather than trusted: pointer coordinates arrive from outside the box, and a
      // disc dragged off the side would be one you could no longer see to put back.
      this.drawDisc(
        this.held.disc,
        clamp(this.held.x, 0, this.width),
        clamp(this.held.y, 0, this.height),
      );
    }
  }

  private drawBase(): void {
    const ctx = this.ctx;
    const w = this.px(BASE_W);
    const h = this.px(BASE_H);
    const x = this.fx(0.5) - w / 2;
    const y = this.fy(BASE_Y);

    const grain = ctx.createLinearGradient(0, y, 0, y + h);
    grain.addColorStop(0, '#a56b33');
    grain.addColorStop(1, '#5d3a1a');
    roundedPath(ctx, x, y, w, h, h * 0.35);
    ctx.fillStyle = grain;
    ctx.fill();

    // A mark under the post the tower is headed for, so the toy says what it is doing.
    ctx.beginPath();
    ctx.arc(this.postX(this.goal), y + h * 0.6, this.px(0.009), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,214,140,0.8)';
    ctx.fill();
  }

  private drawPost(i: number): void {
    const ctx = this.ctx;
    const w = this.px(POST_W);
    const x = this.postX(i) - w / 2;
    const top = this.fy(BASE_Y - POST_H);

    const grain = ctx.createLinearGradient(x, 0, x + w, 0);
    grain.addColorStop(0, '#6f4520');
    grain.addColorStop(0.4, '#96602c');
    grain.addColorStop(1, '#5b3819');
    // Domed at the top, square at the foot: the foot meets the base, and rounding it there
    // pinches the join so the post reads as resting on the wood rather than set into it.
    roundedPath(ctx, x, top, w, this.fy(BASE_Y) - top, w / 2, 0);
    ctx.fillStyle = grain;
    ctx.fill();
  }

  private drawDisc(disc: number, cx: number, cy: number): void {
    const ctx = this.ctx;
    const w = this.px(discWidth(disc));
    const h = this.px(DISC_H);
    const x = cx - w / 2;
    const y = cy - h / 2;
    // Cool at the top of the stack through to warm at the bottom, so size reads as colour
    // too - the ordering is the whole picture, and it should survive a glance.
    const hue = 196 - (disc - 1) * 44;

    const face = ctx.createLinearGradient(0, y, 0, y + h);
    face.addColorStop(0, `hsl(${hue},72%,68%)`);
    face.addColorStop(0.55, `hsl(${hue},66%,55%)`);
    face.addColorStop(1, `hsl(${hue},58%,42%)`);
    roundedPath(ctx, x, y, w, h, h / 2.4);
    ctx.fillStyle = face;
    ctx.fill();

    // The hole. Without it the discs read as bars laid across the tower rather than
    // threaded onto it.
    const bore = this.px(POST_W);
    ctx.fillStyle = 'rgba(52,32,16,0.5)';
    ctx.fillRect(cx - bore / 2, y + h * 0.14, bore, h * 0.72);
  }

  override onPointerDown(x: number, y: number): void {
    // Whatever the autopilot was carrying goes back where it came from. The source post is
    // the one place a disc in mid-air is guaranteed to fit: it was the top of that stack a
    // moment ago, and with the board frozen nothing has landed on it since.
    if (this.flight) {
      this.posts[this.flight.from]!.push(this.flight.disc);
      this.flight = null;
    }
    // Even a grab that catches nothing holds the autopilot off, so a disc never takes off
    // from under a pointer that is already reaching for it.
    this.wait = RESUME_DELAY;
    // From here the round is the player's, and the cycle waits for them to finish it.
    this.engaged = true;
    this.sinceTouch = 0;
    this.setHold(true);

    const post = this.nearestPost(x);
    const stack = this.posts[post]!;
    if (stack.length === 0) return;
    this.held = { disc: stack.pop()!, from: post, x, y };
  }

  override onPointerMove(x: number, y: number): void {
    if (!this.held) return;
    this.held.x = x;
    this.held.y = y;
  }

  override onPointerUp(x: number, _y: number): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.wait = RESUME_DELAY;
    this.sinceTouch = 0;

    const target = this.nearestPost(x);
    const stack = this.posts[target]!;
    const legal = stack.length === 0 || stack[stack.length - 1]! > held.disc;
    // A refused drop goes straight home rather than being left in hand. The rule is the
    // toy, so the answer to breaking it has to be immediate and obvious.
    this.posts[legal ? target : held.from]!.push(held.disc);
    this.thud(held.disc);
  }

  /** Nearest post to an x, which is what makes a drop from outside the box still mean something. */
  private nearestPost(x: number): number {
    let best = 0;
    for (let i = 1; i < POST_COUNT; i++) {
      if (Math.abs(x - this.postX(i)) < Math.abs(x - this.postX(best))) best = i;
    }
    return best;
  }
}

/** Evenly spaced widths, smallest disc to largest. */
function discWidth(disc: number): number {
  return DISC_MIN_W + ((disc - 1) / (DISC_COUNT - 1)) * (DISC_MAX_W - DISC_MIN_W);
}

/** Smoothstep: a disc that starts and stops dead is a disc being teleported in stages. */
function ease(t: number): number {
  const v = clamp(t, 0, 1);
  return v * v * (3 - 2 * v);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * `roundRect` is still uneven across the canvas implementations this runs on.
 *
 * The bottom radius is separate so a shape can be domed at one end and square at the
 * other, which is what the posts want where they meet the base.
 */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  bottomRadius = radius,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  const b = Math.min(bottomRadius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - b);
  ctx.quadraticCurveTo(x + w, y + h, x + w - b, y + h);
  ctx.lineTo(x + b, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - b);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
