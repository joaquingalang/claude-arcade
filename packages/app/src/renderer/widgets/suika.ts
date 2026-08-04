import { CanvasWidget } from './types';

/**
 * Suika, cut down to desk-toy length.
 *
 * The arcade original runs eleven tiers and twenty minutes. Both numbers are wrong here:
 * eleven tiers need a board far bigger than 280px to tell apart, and a game that outlasts
 * the turn it was filling gets cut off rather than finished. Five tiers in a narrow jar
 * fills up in well under a minute, which is the length this thing is actually for.
 *
 * A fixed basket of fruit is what actually bounds a run, and it is not decoration. Suika
 * proper is endless-until-you-lose, and measuring this one showed why that cannot survive
 * the trip: with two melons annihilating, a jar that is played even moderately well drains
 * as fast as it fills and reaches equilibrium. Twenty-five autopilot runs of four simulated
 * minutes each ended in overflow exactly zero times. A game that only ends when you play
 * badly is a game that never hands the window back, so the basket is the guarantee and the
 * overflow line is the way to lose early.
 */

/** Radius of each tier, as a fraction of the box. Five tiers, roughly 1.35x apart. */
const TIER_R = [0.036, 0.049, 0.067, 0.09, 0.118];
/** Two of the largest annihilate instead of growing, so a good run can also clear space. */
const TOP_TIER = TIER_R.length - 1;

/**
 * The five fruit, smallest first.
 *
 * They began as five discs in five colours, which is perfectly legible and completely
 * flat: the jar told you which tier something was and nothing else, and two neighbouring
 * reds twenty pixels across were the same object twice. The arcade original gets its
 * variety from the fruit being *fruit* - a bunch of grapes is not a purple ball - so each
 * tier here gets a cue of its own: a stem, a calyx and seeds, a cluster, a leaf and peel,
 * stripes.
 *
 * The colours still do the work at a glance and the detail is what separates neighbours.
 * None of it is allowed to change the outline: collisions are centre-to-centre against
 * `TIER_R`, so anything drawn past the radius has to be something that visibly overhangs -
 * a stem, a leaf - and never bulk, or the jar would stop matching what it looks like.
 */
const FRUIT = [
  { fill: '#e11d48', shade: '#7f1d1d' }, // cherry
  { fill: '#fb7185', shade: '#be123c' }, // strawberry
  { fill: '#a78bfa', shade: '#5b21b6' }, // grapes
  { fill: '#fb923c', shade: '#c2410c' }, // orange
  { fill: '#4ade80', shade: '#15803d' }, // watermelon
];

const CHERRY = 0;
const STRAWBERRY = 1;
const GRAPES = 2;
const ORANGE = 3;
/** The top of the ladder, and the one tier whose two halves annihilate. */
const MELON = TOP_TIER;

/**
 * The seven berries of a bunch, as offsets in units of the fruit's radius.
 *
 * Six around one, which is the tightest a ring of equal circles packs and so the least
 * background showing through at this size.
 */
const BUNCH: Array<[number, number]> = [
  [0, -0.58],
  [0.5, -0.29],
  [0.5, 0.29],
  [0, 0.58],
  [-0.5, 0.29],
  [-0.5, -0.29],
  [0, 0],
];
const BERRY_R = 0.4;

/** Strawberry seeds: distance from centre, how many, and the angle the ring starts at. */
const SEED_RINGS: Array<[number, number, number]> = [
  [0.3, 4, 0.5],
  [0.6, 7, 0.2],
  [0.86, 9, 0.6],
];

/** Only the three smallest are ever dealt - the rest have to be earned. */
const DEAL_TIERS = 3;

/** The jar, as fractions of the box. */
const LEFT = 0.11;
const RIGHT = 0.89;
const FLOOR = 0.945;
/** Cross this for long enough and the run is over. */
const TOP_LINE = 0.235;

/** Fractions of the box per second squared. Scaled so the jar feels the same at any size. */
const GRAVITY = 5.4;
/** Substeps per frame. A stack of circles under gravity is unstable at one. */
const SUBSTEPS = 4;
/** Relaxation passes per substep - what stops a tall stack from sinking into itself. */
const RELAX = 2;
/**
 * How much of an impact comes back.
 *
 * Fruit are soft and heavy, so this stays well under a rubber ball - but at the 0.08 it
 * started at, everything arrived with a thud and stopped dead, and a jar full of round
 * objects behaved like a bag of wet sand. Nothing was wrong with it; it was just inert.
 *
 * The reason it was that low is real, though: a bouncy jar never settles, and a jar that
 * never settles never merges. BOUNCE_CUTOFF is what buys the bounce back. Below that
 * closing speed a contact simply stops instead of rebounding, so restitution only ever
 * applies to impacts big enough to see, and a resting stack is exactly as dead as before.
 * Without it a settled pile trades imperceptible bounces with the floor forever and the
 * fruit on top never stop shivering.
 */
const RESTITUTION = 0.28;
const WALL_BOUNCE = 0.42;
const FLOOR_BOUNCE = 0.4;
/** Closing speed below which a contact stops rather than bouncing. Fractions of the box/s. */
const BOUNCE_CUTOFF = 0.25;
/**
 * Grip along a contact, as a fraction of the normal impulse - Coulomb friction, roughly.
 *
 * Without it fruit slide across each other frictionlessly, which is the other half of why
 * the pile read as stale: a fruit landing on a shoulder used to shoot sideways off it.
 */
const FRICTION = 0.35;
const AIR_DRAG = 0.999;

/**
 * Spin.
 *
 * Not physics the jar needs - nothing collides differently for it, and the merge test is
 * still centre-to-centre. It is here because the fruit stopped being plain discs: a
 * strawberry that rides down a slope without ever turning reads as a sticker rather than
 * as a strawberry. The tangential impulse friction already computes is what drives it, so
 * this rides along on the contact solve rather than needing an angular one of its own -
 * but it does have to ride along in both directions. Friction reads the spin back out of
 * the contact as well as writing it in, or nothing ever slows a fruit down again.
 */
const SPIN_GAIN = 0.7;
const SPIN_DRAG = 0.998;
/**
 * How much of a contact's grip goes into resisting rolling, as opposed to sliding.
 *
 * Air drag alone cannot settle a pile: it bleeds spin at a fixed rate no matter how buried
 * a fruit is, and a contact that re-solves every relaxation pass feeds spin in faster than
 * that. This scales with the load instead, so the deeper a fruit is pinned the harder the
 * pile insists it hold still. Well under FRICTION, or fruit would stop dead on contact
 * rather than rolling off each other into the gaps.
 *
 * Which is also the limit of what it can do, and it is worth not mistaking this for the
 * thing that settles a jar: being well under FRICTION means a saturated contact feeds spin
 * in about three times faster than this takes it out. It takes the edge off a roll. What
 * stops a pile turning is REST_TRAVEL.
 */
const ROLL_RESIST = 0.12;
/** Radians per second. A fruit spinning faster than this reads as a glitch, not a tumble. */
const MAX_SPIN = 9;
/**
 * What counts as a fruit that has stopped, and how fast a stopped fruit's spin dies.
 *
 * This is the endless rotation, and it is worth setting down what it actually was, because
 * every obvious fix for it is wrong.
 *
 * A fruit that has come to rest is still handed a sliver of gravity every substep. The
 * contacts holding it up take that sliver straight back, but they are solved one pair at a
 * time and only twice per substep, so a fruit resting on two others is never quite square
 * with both at once: the sliver lands slightly across each contact rather than square into
 * it, and a sliver across a contact is a sliver of slide. Friction is obliged to answer it,
 * and the answer it wants is the two fruit counter-rotating at matching rim speeds - two
 * discs rolling on each other, which has no slip at all and so satisfies friction
 * perfectly. Neither of them can go anywhere, so nothing ever spends the spin; the next
 * substep brings another sliver, and it converges on a pile running like clockwork.
 * Measured across forty random piles: up to half a radian a second, indefinitely, on fruit
 * that had not moved a pixel in two seconds.
 *
 * Damping cannot fix it. The leftovers arrive on a schedule and damping removes a fraction
 * of what is there, so the two balance at some speed rather than at zero - bleeding spin at
 * 15% a substep, 240 times a second, still left a third of a radian a second. ROLL_RESIST
 * cannot either: saturated friction feeds spin in about three times faster than the brake
 * takes it out. The injection has to stop instead of being mopped up.
 *
 * Which needs a way to tell a fruit that has stopped from one that is rolling, and no
 * velocity in the solver can do it. Slip cannot: a fruit rolling properly has none, that
 * being what rolling is. Speed cannot: a fruit squeezed into a pile carries a large
 * velocity into its neighbours that is solver residue rather than travel. Nor can the slide
 * along the contact - measured over settled piles it reaches 38px/s on fruit going nowhere,
 * while fruit genuinely on the move read half that.
 *
 * What does work is distance. Residue is cancelled and re-created every substep and never
 * adds up to displacement; travel does, by definition. So a fruit that has covered less
 * than REST_TRAVEL over a whole frame while touching something has stopped, whatever its
 * velocities claim, and a contact between two such fruit does not drive spin at all. It
 * still grips, which is what stops a pile creeping sideways, and what spin is already there
 * is bled off. Rolling is untouched, because a fruit that is rolling is going somewhere.
 *
 * The contact requirement matters as much as the distance: a fruit in the air covers almost
 * no ground at the top of a bounce or in the instant it leaves the hand, and that tumble is
 * real.
 */
const REST_TRAVEL = 0.04;
const REST_SPIN_DECAY = 0.85;

/** Seconds between drops. Long enough that a double-click can't dump two fruit at once. */
const RELOAD = 0.4;
/**
 * Fruit in a run. The upper bound on how long the widget can hold the window.
 *
 * At the autopilot's cadence this is a little over half a minute; a human who deliberates
 * gets a little longer, and one who spams gets a much shorter run and a worse score.
 */
const DROPS = 26;
/** After the last fruit, long enough for the pile to settle and final merges to land. */
const EMPTY_SETTLE = 2.2;
/**
 * How long a fruit must be in play before it can trip the overflow line.
 *
 * Without it the fruit you just dropped ends the game on its way past the line, and so
 * does the one a merge just created. Only settled fruit count against you.
 */
const SETTLE_AGE = 1;
/** How long the line has to stay broken. A fruit knocked up through it is not an overflow. */
const OVERFLOW_GRACE = 1.1;
/** How long the final score is held, so the run has an ending rather than a cut. */
const OVER_PAUSE = 1.9;

/** Autopilot cadence, until the pointer arrives. */
const AUTO_INTERVAL = 1;
const AUTO_AIM_SPEED = 1.6;

const BURST_LIFE = 0.42;
const MAX_BURSTS = 8;

interface Fruit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tier: number;
  /** Seconds in play. Gates the overflow test - see SETTLE_AGE. */
  age: number;
  /** 0 -> 1 after a merge, for the little swell. */
  born: number;
  /** Per-fruit phase, so identical tiers don't share a stem angle or a seed scatter. */
  seed: number;
  /** Orientation, radians clockwise. Only the fruit's own markings turn with it. */
  rot: number;
  /** Radians per second. See SPIN_GAIN. */
  spin: number;
  /**
   * Whether anything was pushing back on this fruit during the substep just solved.
   *
   * Cleared before the contacts are found and set by whichever of them touches it, so it
   * only means anything between the solve and the end of the substep - which is where the
   * frame's verdict reads it.
   */
  touching: boolean;
  /**
   * Whether this fruit went nowhere last frame while resting on something. See REST_TRAVEL.
   *
   * Decided once a frame, off distance covered, and read all through the next one: it is
   * what the contact solve asks before it turns anything.
   */
  parked: boolean;
}

interface Burst {
  x: number;
  y: number;
  r: number;
  t: number;
  tier: number;
}

export class Suika extends CanvasWidget {
  private fruit: Fruit[] = [];
  private bursts: Burst[] = [];
  private score = 0;
  private next = 0;
  private aim = 0.5;
  private reload = 0;
  private overflow = 0;
  private overTimer = 0;
  private over = false;
  /** Which ending arrived. The two read very differently and the result line says which. */
  private reason: 'full' | 'empty' = 'empty';
  /** Fruit left in the basket. */
  private remaining = DROPS;
  private emptyTimer = 0;
  private time = 0;
  /** Cleared by the first pointer event and never set again - autopilot is a demo, not a co-op. */
  private auto = true;
  private autoTimer = 0;
  private autoAim = 0.5;

  private px(fraction: number): number {
    return fraction * this.size;
  }

  private get left(): number {
    return this.px(LEFT);
  }

  private get right(): number {
    return this.px(RIGHT);
  }

  private get floor(): number {
    return this.px(FLOOR);
  }

  private get topLine(): number {
    return this.px(TOP_LINE);
  }

  private radius(tier: number): number {
    return this.px(TIER_R[tier] ?? TIER_R[0]!);
  }

  protected init(): void {
    this.fruit = [];
    this.bursts = [];
    this.score = 0;
    this.aim = 0.5;
    this.autoAim = 0.5;
    this.reload = 0;
    this.overflow = 0;
    this.overTimer = 0;
    this.over = false;
    this.reason = 'empty';
    this.remaining = DROPS;
    this.emptyTimer = 0;
    this.time = 0;
    this.auto = true;
    this.autoTimer = AUTO_INTERVAL * 0.6;
    this.next = this.deal();
  }

  private deal(): number {
    return Math.floor(Math.random() * DEAL_TIERS);
  }

  /** Where the queued fruit is hovering, in canvas coordinates. */
  private aimX(): number {
    const r = this.radius(this.next);
    return clamp(this.left + this.aim * (this.right - this.left), this.left + r, this.right - r);
  }

  protected update(dt: number): void {
    this.time += dt;
    this.ageBursts(dt);

    if (this.over) {
      // The pile keeps settling under the final score rather than freezing mid-fall.
      this.step(dt);
      this.overTimer += dt;
      if (this.overTimer >= OVER_PAUSE) this.finish();
      return;
    }

    if (this.reload > 0) this.reload -= dt;
    if (this.auto) this.autopilot(dt);

    this.step(dt);
    this.checkOverflow(dt);
    this.checkEmpty(dt);
  }

  /**
   * The basket ran out.
   *
   * Deliberately not instant: the last fruit is still falling and may still merge, and
   * ending on the frame it leaves your hand would cut off the best part of the drop.
   */
  private checkEmpty(dt: number): void {
    if (this.over || this.remaining > 0) return;
    this.emptyTimer += dt;
    if (this.emptyTimer < EMPTY_SETTLE) return;
    this.over = true;
    this.reason = 'empty';
    this.overTimer = 0;
  }

  /**
   * Drop on a timer, aiming at whatever the queued fruit could merge with.
   *
   * A game that sits still until touched reads as a screenshot, and this one has no motion
   * of its own to fall back on. It plays badly on purpose - it aims
   * at a match and ignores everything else - because a demo that never loses would never
   * hand the widget back.
   */
  private autopilot(dt: number): void {
    let target = this.autoAim;
    let best = Infinity;
    for (const f of this.fruit) {
      if (f.tier !== this.next) continue;
      // The lowest match is the safest one to pile onto.
      if (f.y < best) continue;
      best = f.y;
      target = (f.x - this.left) / (this.right - this.left);
    }
    if (best === Infinity) target = 0.5 + Math.sin(this.time * 0.7) * 0.28;

    const move = AUTO_AIM_SPEED * dt;
    this.autoAim += clamp(target - this.autoAim, -move, move);
    this.aim = this.autoAim;

    this.autoTimer -= dt;
    if (this.autoTimer <= 0) {
      this.autoTimer = AUTO_INTERVAL;
      this.drop();
    }
  }

  private drop(): void {
    if (this.over || this.reload > 0 || this.remaining <= 0) return;
    this.remaining--;
    const tier = this.next;
    this.fruit.push({
      x: this.aimX(),
      y: this.topLine - this.radius(tier) - this.px(0.03),
      vx: 0,
      vy: 0,
      tier,
      age: 0,
      born: 1,
      seed: Math.random() * Math.PI * 2,
      // Nearly upright, with a little off each one. A fruit leaves the hand the way it was
      // held; the tumbling is something the pile does to it.
      rot: (Math.random() * 2 - 1) * 0.35,
      spin: (Math.random() * 2 - 1) * 0.6,
      touching: false,
      parked: false,
    });
    this.next = this.deal();
    this.reload = RELOAD;
  }

  /** One frame of physics, split into substeps so a tall stack stays put. */
  private step(dt: number): void {
    const h = dt / SUBSTEPS;
    // Where everything started the frame, for the only test of stillness that works. The
    // fruit list cannot change until `merge` at the bottom, so these stay in step with it.
    const fromX = this.fruit.map((f) => f.x);
    const fromY = this.fruit.map((f) => f.y);
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const f of this.fruit) {
        f.age += h;
        if (f.born < 1) f.born = Math.min(1, f.born + h * 6);
        f.vy += this.px(GRAVITY) * h;
        f.vx *= AIR_DRAG;
        f.x += f.vx * h;
        f.y += f.vy * h;
        f.spin = clamp(f.spin * SPIN_DRAG, -MAX_SPIN, MAX_SPIN);
        f.rot += f.spin * h;
        f.touching = false;
        this.contain(f);
      }
      for (let r = 0; r < RELAX; r++) {
        this.collide();
        for (const f of this.fruit) this.settle(f);
      }
      for (const f of this.fruit) this.park(f);
    }
    // The frame's verdict, for the next one to act on: touching something, and having got
    // nowhere in spite of whatever its velocities were doing.
    const still = this.px(REST_TRAVEL) * dt;
    for (let i = 0; i < this.fruit.length; i++) {
      const f = this.fruit[i]!;
      f.parked = f.touching && Math.hypot(f.x - fromX[i]!, f.y - fromY[i]!) < still;
    }
    this.merge();
  }

  /**
   * Keep a fruit inside the jar, bouncing it off whatever it hit.
   *
   * Each surface also grips the fruit, which is what turns a skid along the floor into a
   * roll along it. How hard it grips depends on how hard the fruit is pressed into that
   * particular surface, which is the whole difference between a wall that turns a fruit
   * sliding down it and a wall a fruit is merely resting beside.
   */
  private contain(f: Fruit): void {
    const r = this.radius(f.tier);
    const cutoff = this.px(BOUNCE_CUTOFF);
    if (f.x < this.left + r) {
      f.x = this.left + r;
      f.touching = true;
      const press = Math.max(0, -f.vx);
      if (f.vx < 0) f.vx = f.vx > -cutoff ? 0 : f.vx * -WALL_BOUNCE;
      rubLeft(f, r, press);
    } else if (f.x > this.right - r) {
      f.x = this.right - r;
      f.touching = true;
      const press = Math.max(0, f.vx);
      if (f.vx > 0) f.vx = f.vx < cutoff ? 0 : f.vx * -WALL_BOUNCE;
      rubRight(f, r, press);
    }
    if (f.y > this.floor - r) {
      f.y = this.floor - r;
      f.touching = true;
      const press = Math.max(0, f.vy);
      if (f.vy > 0) f.vy = f.vy < cutoff ? 0 : f.vy * -FLOOR_BOUNCE;
      // Ground friction, or the pile slides apart forever and nothing ever stacks.
      f.vx *= 0.88;
      rubFloor(f, r, press);
    }
  }

  /**
   * The jar's last word, after the fruit have been resolved against each other.
   *
   * A relaxation pass has no idea the floor exists: it shoves the fruit at the bottom of a
   * stack down through it and hands it the whole pile's weight as downward velocity, and
   * nothing until the next substep takes either back. A settled pile ends up buried a few
   * pixels into the floor, every fruit in it carrying a permanent downward speed it can
   * never spend. Only into-surface motion is cancelled, so a fruit that `contain` has
   * already bounced is on its way up and is left alone.
   *
   * The speed being cancelled here is the one thing in the whole solver that knows what a
   * fruit weighs. `contain` runs before the pile has pushed down and can only ever see one
   * substep of gravity, so it grips a buried cherry no harder than a floating one; by the
   * time the fruit reaches this point it is carrying everything stacked on top of it, so
   * this is where the floor gets the grip to actually hold it - which is what keeps the
   * bottom of a stack from creeping out from under the rest of it.
   */
  private settle(f: Fruit): void {
    const r = this.radius(f.tier);
    if (f.x < this.left + r) {
      f.x = this.left + r;
      f.touching = true;
      if (f.vx < 0) {
        rubLeft(f, r, -f.vx);
        f.vx = 0;
      }
    } else if (f.x > this.right - r) {
      f.x = this.right - r;
      f.touching = true;
      if (f.vx > 0) {
        rubRight(f, r, f.vx);
        f.vx = 0;
      }
    }
    if (f.y > this.floor - r) {
      f.y = this.floor - r;
      f.touching = true;
      if (f.vy > 0) {
        rubFloor(f, r, f.vy);
        f.vy = 0;
      }
    }
  }

  /**
   * Bleed off whatever spin a fruit that has stopped still had.
   *
   * Nothing drives a parked fruit any more, so this only has to clear what it arrived with
   * rather than fight anything - see REST_TRAVEL. Deliberately the last thing each substep
   * does, because `rot` advances at the *top* of the next one: what a fruit is about to be
   * turned by is whatever spin is left standing here.
   */
  private park(f: Fruit): void {
    if (f.parked) f.spin *= REST_SPIN_DECAY;
  }

  /**
   * Push overlapping fruit apart and exchange momentum.
   *
   * Mass goes as area, so a melon shoulders a cherry aside rather than the two splitting
   * the difference - which is most of what makes the pile read as fruit rather than as
   * equal-weight billiard balls.
   *
   * Two impulses per contact rather than one: along the normal, which is the bounce, and
   * along the tangent, which is the grip. The tangential one is what lets a fruit roll off
   * a shoulder instead of skating off it, and it is also the only thing that ever sets a
   * fruit spinning.
   */
  private collide(): void {
    const n = this.fruit.length;
    for (let i = 0; i < n; i++) {
      const a = this.fruit[i]!;
      const ra = this.radius(a.tier);
      for (let j = i + 1; j < n; j++) {
        const b = this.fruit[j]!;
        const rb = this.radius(b.tier);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = ra + rb;
        const sq = dx * dx + dy * dy;
        if (sq >= min * min) continue;

        const d = Math.sqrt(sq) || 0.0001;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = min - d;
        a.touching = true;
        b.touching = true;

        const ima = 1 / (ra * ra);
        const imb = 1 / (rb * rb);
        const inv = ima + imb;

        const corr = (overlap * 0.8) / inv;
        a.x -= nx * corr * ima;
        a.y -= ny * corr * ima;
        b.x += nx * corr * imb;
        b.y += ny * corr * imb;

        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn >= 0) continue;
        // A contact slower than the cutoff is resting, not landing - see RESTITUTION.
        const bounce = -vn < this.px(BOUNCE_CUTOFF) ? 0 : RESTITUTION;
        const jImp = (-(1 + bounce) * vn) / inv;
        a.vx -= jImp * nx * ima;
        a.vy -= jImp * ny * ima;
        b.vx += jImp * nx * imb;
        b.vy += jImp * ny * imb;

        const tx = -ny;
        const ty = nx;
        // How fast the two *skins* are sliding past each other, which is not how fast the
        // two centres are: a fruit that is already turning is dragging its surface along
        // the contact whether or not it is going anywhere. Measured between centres alone
        // - as this was - friction can never see the spin it just handed out, so a fruit
        // wedged in a notch collects a fresh sliver of torque every substep, nothing ever
        // takes it back, and it sits perfectly still turning at MAX_SPIN forever.
        const vt =
          (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - (a.spin * ra + b.spin * rb);
        // Capped at the normal impulse's share, or the grip could reverse the slide it is
        // supposed to be slowing and the two fruit would saw against each other.
        const limit = FRICTION * jImp;
        // The impulse turns the fruit as well as shoving them, so the mass it works against
        // has to include the angular share - a disc's rim answers an impulse twice as
        // readily as its centre of mass, scaled by however much of that SPIN_GAIN keeps.
        // Divide by `inv` alone and a contact overshoots rolling instead of arriving at it.
        const jt = clamp(-vt / (inv * (1 + 2 * SPIN_GAIN)), -limit, limit);
        a.vx -= jt * tx * ima;
        a.vy -= jt * ty * ima;
        b.vx += jt * tx * imb;
        b.vy += jt * ty * imb;

        // Both turn the same way, the way two circles rubbing past each other do. The 2 is
        // the disc's moment of inertia, mr^2/2, folded in.
        //
        // Unless both sides have stopped, in which case this contact is holding a pile up
        // rather than rolling anything, and the slide it is answering is the substep's
        // sliver of gravity landing across it rather than square into it. Every radian it
        // would hand out here is an artefact of the solve, and handing them out anyway is
        // the whole of the endless-rotation bug - see REST_TRAVEL.
        if (!a.parked || !b.parked) {
          a.spin -= (2 * SPIN_GAIN * jt * ima) / ra;
          b.spin -= (2 * SPIN_GAIN * jt * imb) / rb;
        }

        // Fruit are soft, and where two of them press together they flatten - a flattened
        // patch resists being rolled through. Friction alone will not do this, because two
        // fruit turning opposite ways at matching rim speeds have no slip between them at
        // all and friction is perfectly satisfied. Bounded by the load the same way grip is,
        // so fruit resting lightly are barely slowed and one pinned under a stack stops
        // quickly, and never past zero, or the resistance would drive the spin it removes.
        // This takes the edge off a roll; it is not what settles a pile. See ROLL_RESIST.
        const brake = 2 * SPIN_GAIN * ROLL_RESIST * jImp;
        a.spin -= clamp(a.spin, (-brake * ima) / ra, (brake * ima) / ra);
        b.spin -= clamp(b.spin, (-brake * imb) / rb, (brake * imb) / rb);
      }
    }
  }

  /**
   * Fuse touching pairs of equal tier.
   *
   * Collected first and applied after, because merging inside the pair loop would mutate
   * the array being walked. Each fruit takes part in at most one merge per frame, so a
   * column of four cherries becomes two grapes rather than one and a leftover.
   */
  private merge(): void {
    const n = this.fruit.length;
    if (n < 2) return;
    const used = new Set<number>();
    const pairs: Array<[number, number]> = [];

    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const a = this.fruit[i]!;
      const ra = this.radius(a.tier);
      for (let j = i + 1; j < n; j++) {
        if (used.has(j)) continue;
        const b = this.fruit[j]!;
        if (b.tier !== a.tier) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = ra + this.radius(b.tier);
        if (dx * dx + dy * dy >= min * min) continue;
        used.add(i);
        used.add(j);
        pairs.push([i, j]);
        break;
      }
    }
    if (pairs.length === 0) return;

    for (const [i, j] of pairs) {
      const a = this.fruit[i]!;
      const b = this.fruit[j]!;
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      const tier = a.tier;

      this.score += (tier + 1) * 2;
      this.burst(x, y, this.radius(tier), tier);

      // Two melons annihilate. Without a top of the ladder the jar can only ever fill up,
      // and a run that is going well would be punished for it.
      if (tier >= TOP_TIER) {
        this.score += 12;
        continue;
      }
      this.fruit.push({
        x,
        y,
        vx: (a.vx + b.vx) * 0.5,
        vy: (a.vy + b.vy) * 0.5,
        tier: tier + 1,
        // Inherits the older half's age: a merge in the danger zone must not buy a reprieve.
        age: Math.max(a.age, b.age),
        born: 0,
        seed: Math.random() * Math.PI * 2,
        rot: a.rot,
        spin: (a.spin + b.spin) * 0.5,
        touching: false,
        parked: false,
      });
    }

    this.fruit = this.fruit.filter((_, i) => !used.has(i));
  }

  private burst(x: number, y: number, r: number, tier: number): void {
    this.bursts.push({ x, y, r, t: 0, tier });
    if (this.bursts.length > MAX_BURSTS) this.bursts.shift();
  }

  private ageBursts(dt: number): void {
    let kept = 0;
    for (const b of this.bursts) {
      b.t += dt / BURST_LIFE;
      if (b.t < 1) this.bursts[kept++] = b;
    }
    this.bursts.length = kept;
  }

  /** Settled fruit above the line for long enough ends the run. */
  private checkOverflow(dt: number): void {
    let broken = false;
    for (const f of this.fruit) {
      if (f.age < SETTLE_AGE) continue;
      if (f.y - this.radius(f.tier) < this.topLine) {
        broken = true;
        break;
      }
    }

    if (!broken) {
      this.overflow = 0;
      return;
    }
    this.overflow += dt;
    if (this.overflow >= OVERFLOW_GRACE) {
      this.over = true;
      this.reason = 'full';
      this.overTimer = 0;
    }
  }

  protected draw(): void {
    this.drawJar();
    this.drawLine();
    if (!this.over) this.drawQueue();
    for (const f of this.fruit) this.drawFruit(f);
    this.drawBursts();
    this.drawScore();
    this.drawBasket();
    if (this.over) this.drawResult();
  }

  private drawJar(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.lineWidth = Math.max(1.5, this.px(0.009));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.left, this.topLine - this.px(0.02));
    ctx.lineTo(this.left, this.floor);
    ctx.lineTo(this.right, this.floor);
    ctx.lineTo(this.right, this.topLine - this.px(0.02));
    ctx.stroke();
  }

  /**
   * The overflow line, which reddens as the grace period runs out.
   *
   * The only warning the game gives. A jar that simply ends would leave you unsure whether
   * you lost or it broke.
   */
  private drawLine(): void {
    const ctx = this.ctx;
    const heat = Math.min(1, this.overflow / OVERFLOW_GRACE);
    const dash = this.px(0.028);
    ctx.strokeStyle =
      heat > 0
        ? `rgba(248,113,113,${0.35 + 0.55 * heat})`
        : 'rgba(148,163,184,0.32)';
    ctx.lineWidth = Math.max(1, this.px(0.006));
    ctx.beginPath();
    for (let x = this.left; x < this.right; x += dash * 2) {
      ctx.moveTo(x, this.topLine);
      ctx.lineTo(Math.min(x + dash, this.right), this.topLine);
    }
    ctx.stroke();
  }

  /** The queued fruit, plus the column it will fall down. */
  private drawQueue(): void {
    const ctx = this.ctx;
    const x = this.aimX();
    const r = this.radius(this.next);
    const ready = this.reload <= 0;

    ctx.strokeStyle = `rgba(203,213,225,${ready ? 0.28 : 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = this.topLine; y < this.floor; y += this.px(0.05)) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, Math.min(y + this.px(0.025), this.floor));
    }
    ctx.stroke();

    // Dimmed while reloading, so "not yet" is visible rather than a click that does nothing.
    ctx.save();
    ctx.globalAlpha = ready ? 1 : 0.45;
    this.drawBall(x, this.topLine - r - this.px(0.05), r, this.next, 0);
    ctx.restore();
  }

  private drawFruit(f: Fruit): void {
    // A merge swells past full size and settles back - the one bit of squash the jar gets.
    const swell = 1 + Math.sin(f.born * Math.PI) * 0.18;
    this.drawBall(f.x, f.y, this.radius(f.tier) * swell, f.tier, f.seed, f.rot);
  }

  /**
   * One fruit, in three passes, split by what turns with it and what does not.
   *
   * Markings are painted on the skin, so they turn, and they are clipped to the body.
   * Stems and leaves are part of the fruit and turn too, but they hang past the outline
   * and so cannot share that clip. The specular highlight belongs to the room rather than
   * to the fruit and must stay put, or a rolling melon looks like a lamp orbiting it.
   */
  private drawBall(
    x: number,
    y: number,
    r: number,
    tier: number,
    seed: number,
    rot = 0,
  ): void {
    const ctx = this.ctx;
    const style = FRUIT[tier] ?? FRUIT[0]!;

    if (tier === GRAPES) {
      this.drawBunch(x, y, r, rot, style);
    } else {
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, style.fill);
      g.addColorStop(1, style.shade);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(x, y);
      ctx.rotate(rot);
      this.markings(tier, r);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    this.crown(tier, r, seed);
    ctx.restore();

    // The bunch gets its highlights per berry instead - one across the whole cluster would
    // light it as though it were the single sphere it is trying not to look like.
    if (tier !== GRAPES) {
      ctx.beginPath();
      ctx.arc(x - r * 0.34, y - r * 0.36, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fill();
    }
  }

  /** Whatever is painted on the skin. Drawn at the origin, clipped to the body. */
  private markings(tier: number, r: number): void {
    const ctx = this.ctx;

    if (tier === CHERRY) {
      // The seam, and the only marking a 20px fruit has room for.
      ctx.strokeStyle = 'rgba(76,5,25,0.4)';
      ctx.lineWidth = Math.max(1, r * 0.14);
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r);
      ctx.quadraticCurveTo(r * 0.32, 0, -r * 0.12, r);
      ctx.stroke();
      return;
    }

    if (tier === STRAWBERRY) {
      // Seeds in rings rather than scattered: a real one is close to regular, and at this
      // size an even texture is the difference between seeds and dirt.
      ctx.fillStyle = 'rgba(254,240,138,0.9)';
      for (const [dist, count, phase] of SEED_RINGS) {
        for (let i = 0; i < count; i++) {
          const a = phase + (i / count) * Math.PI * 2;
          const px = Math.cos(a) * dist * r;
          const py = Math.sin(a) * dist * r;
          ctx.beginPath();
          ctx.ellipse(px, py, r * 0.09, r * 0.055, a, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    if (tier === ORANGE) {
      // Peel dimples, scattered off a fixed hash rather than Math.random, or the texture
      // would crawl over the fruit every frame.
      ctx.fillStyle = 'rgba(154,52,18,0.3)';
      for (let i = 0; i < 24; i++) {
        const a = hash(i) * Math.PI * 2;
        // Square-rooted, so the dimples spread evenly over the disc instead of crowding
        // into the middle the way a raw uniform radius would.
        const d = Math.sqrt(hash(i + 41)) * r * 0.88;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.7, r * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(120,53,15,0.4)';
      ctx.beginPath();
      ctx.arc(0, r * 0.66, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (tier === MELON) {
      // Bowed outwards rather than ruled straight, which is what makes a flat circle read
      // as something round with a pattern wrapped over it.
      ctx.strokeStyle = 'rgba(20,83,45,0.5)';
      ctx.lineWidth = Math.max(1.5, r * 0.15);
      for (let i = -2; i <= 2; i++) {
        const c = i * r * 0.44;
        ctx.beginPath();
        ctx.moveTo(c * 0.5, -r * 1.05);
        ctx.quadraticCurveTo(c * 1.7, 0, c * 0.5, r * 1.05);
        ctx.stroke();
      }
    }
  }

  /**
   * Stems, leaves and the strawberry's calyx - the parts that hang off the outline.
   *
   * Drawn unclipped and after the body so they overhang the way a real stem does, and
   * turned with the fruit, which is most of what makes a tumbling pile read as fruit
   * rather than as painted discs. `seed` only leans them, so no two of a tier match.
   */
  private crown(tier: number, r: number, seed: number): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    const lean = Math.cos(seed) * 0.3;

    if (tier === CHERRY) {
      // Drawn at every size, unlike the stems below. A cherry twenty pixels across has no
      // other way to say what it is - without the stalk it is just the smallest red disc.
      ctx.strokeStyle = 'rgba(101,163,13,0.95)';
      ctx.lineWidth = Math.max(1.1, r * 0.13);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.88);
      ctx.quadraticCurveTo(r * (0.1 + lean), -r * 1.34, r * (0.42 + lean), -r * 1.58);
      ctx.stroke();
      return;
    }

    if (tier === STRAWBERRY) {
      ctx.fillStyle = '#4ade80';
      for (let i = -2; i <= 2; i++) {
        const a = -Math.PI / 2 + i * 0.42;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.7);
        ctx.lineTo(Math.cos(a - 0.17) * r * 1.04, Math.sin(a - 0.17) * r * 1.04);
        ctx.lineTo(Math.cos(a + 0.17) * r * 1.04, Math.sin(a + 0.17) * r * 1.04);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = '#65a30d';
      ctx.lineWidth = Math.max(1, r * 0.11);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.85);
      ctx.lineTo(lean * r * 0.4, -r * 1.3);
      ctx.stroke();
      return;
    }

    if (tier === GRAPES) {
      ctx.strokeStyle = 'rgba(101,73,40,0.95)';
      ctx.lineWidth = Math.max(1.2, r * 0.09);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.8);
      ctx.quadraticCurveTo(lean * r * 0.5, -r * 1.12, lean * r * 0.25, -r * 1.32);
      ctx.stroke();
      // A leaf, because a bare stalk on a bunch reads as a broken twig.
      this.leaf(r * 0.36, -r * 1.1, r * 0.3, r * 0.14);
      return;
    }

    if (tier === ORANGE) {
      ctx.fillStyle = '#3f6212';
      ctx.beginPath();
      ctx.arc(0, -r * 0.92, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      this.leaf(r * 0.44, -r * 1.02, r * 0.33, r * 0.15);
      return;
    }

    if (tier === MELON) {
      ctx.strokeStyle = 'rgba(77,124,15,0.95)';
      ctx.lineWidth = Math.max(1.4, r * 0.085);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.94);
      ctx.quadraticCurveTo(r * 0.32, -r * 1.18, r * (0.08 + lean), -r * 1.4);
      ctx.stroke();
    }
  }

  /** A leaf tilted up and away, with the midrib that stops it reading as a green blob. */
  private leaf(cx: number, cy: number, rx: number, ry: number): void {
    const ctx = this.ctx;
    const tilt = -0.45;
    const dx = Math.cos(tilt) * rx;
    const dy = Math.sin(tilt) * rx;

    ctx.fillStyle = '#4d7c0f';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(22,101,52,0.75)';
    ctx.lineWidth = Math.max(0.8, ry * 0.25);
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
  }

  /**
   * Grapes, the one tier that is not a ball.
   *
   * A bunch drawn as a single purple sphere is the orange below it with the hue turned
   * down, and this is the tier a run spends most of its time looking at. Seven berries
   * over a dark backing disc: the backing fills the gaps between them, because the window
   * is transparent and anything left uncovered shows the desktop through the fruit.
   */
  private drawBunch(
    x: number,
    y: number,
    r: number,
    rot: number,
    style: { fill: string; shade: string },
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.94, 0, Math.PI * 2);
    ctx.fillStyle = '#3b0764';
    ctx.fill();

    const br = r * BERRY_R;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (const [ox, oy] of BUNCH) {
      const bx = x + (ox * cos - oy * sin) * r;
      const by = y + (ox * sin + oy * cos) * r;
      // Lit from the same corner as every other fruit, in the box's frame rather than the
      // bunch's, so turning the cluster moves the berries and not the light.
      const g = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
      g.addColorStop(0, style.fill);
      g.addColorStop(1, style.shade);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(bx - br * 0.3, by - br * 0.32, br * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
    }
  }

  private drawBursts(): void {
    const ctx = this.ctx;
    for (const b of this.bursts) {
      const fade = 1 - b.t;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (1 + b.t * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba((FRUIT[b.tier] ?? FRUIT[0]!).fill, 0.7 * fade);
      ctx.lineWidth = Math.max(1, this.px(0.012) * fade);
      ctx.stroke();
    }
  }

  private drawScore(): void {
    const ctx = this.ctx;
    // Transparent window over an unknown desktop: the number carries its own contrast.
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `600 ${Math.round(this.px(0.085))}px system-ui, sans-serif`;
    ctx.fillText(String(this.score), this.left, this.px(0.055));
    ctx.restore();
  }

  /**
   * Fruit left, as a draining bar.
   *
   * A second number beside the score is one number too many at this size, and a bar is read
   * without being looked at. It reddens over the last few so the end is seen coming rather
   * than arriving - the same reason the overflow line changes colour.
   */
  private drawBasket(): void {
    const ctx = this.ctx;
    const w = this.right - this.left;
    const y = this.px(0.175);
    const h = this.px(0.016);
    const share = Math.max(0, this.remaining / DROPS);

    ctx.fillStyle = 'rgba(148,163,184,0.2)';
    ctx.fillRect(this.left, y, w, h);
    ctx.fillStyle = share < 0.2 ? 'rgba(251,146,60,0.9)' : 'rgba(148,163,184,0.55)';
    ctx.fillRect(this.left, y, w * share, h);
  }

  private drawResult(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 ${Math.round(this.px(0.075))}px system-ui, sans-serif`;
    // The two endings are not the same result and must not read as the same result.
    ctx.fillText(this.reason === 'full' ? 'full' : 'out of fruit', this.size / 2, this.px(0.115));
    ctx.restore();
  }

  /** Any pointer event retires the autopilot for the rest of the run. */
  private take(x: number): void {
    this.auto = false;
    this.aim = clamp((x - this.left) / (this.right - this.left), 0, 1);
  }

  override onPointerDown(x: number, _y: number): void {
    if (this.over) return;
    this.take(x);
    this.drop();
  }

  override onPointerMove(x: number, _y: number): void {
    if (this.over) return;
    this.take(x);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Friction against the jar itself, as an impulse along the surface.
 *
 * `slip` is how fast the fruit's skin is travelling across the surface - zero once it is
 * rolling rather than sliding - and `press` is how hard it is being pushed into that
 * surface, which is the speed the surface has to cancel to stop it going through.
 *
 * The pressing is the point, and leaving it out is what made fruit spin forever. This used
 * to drag spin a fixed fraction of the way towards rolling every substep no matter what,
 * and a fruit at rest is not at rest as far as one substep is concerned: it is handed a
 * sliver of gravity, and the floor takes it straight back. Read as a slide, that sliver is
 * a fruit endlessly skidding down a wall it is only leaning against - so it span, at a
 * rate set by the angle it happened to be wedged at, without ever moving. A wall a fruit
 * rests beside presses on it with nothing at all, and now grips it by exactly that much.
 *
 * Divided rather than applied whole because the impulse turns the fruit as well as shoving
 * it, exactly as in `collide` - a disc's rim answers twice as readily as its centre of
 * mass, scaled by whatever share of that SPIN_GAIN keeps.
 *
 * Scaling by the pressing was not enough on its own, though, and the walls are the worst
 * case in the jar: a wall runs the same way gravity does, so the sliver a resting fruit is
 * handed every substep points *straight along* it, and the harder the pile squeezes a fruit
 * into the wall the more grip that sliver is answered with. So a surface, like a
 * neighbouring fruit, grips a parked fruit without ever turning it. See REST_TRAVEL.
 */
function surfaceGrip(slip: number, press: number): number {
  const limit = FRICTION * press;
  return clamp(-slip / (1 + 2 * SPIN_GAIN), -limit, limit);
}

/**
 * The left wall's grip.
 *
 * A fruit sliding down the wall rolls the way its contact side has to travel to stay still
 * against it: up, so clockwise. Both walls are only ever felt by the fruit's vertical
 * motion, and the right wall is the mirror of this one.
 */
function rubLeft(f: Fruit, r: number, press: number): void {
  const jt = surfaceGrip(f.vy - f.spin * r, press);
  f.vy += jt;
  if (!f.parked) f.spin -= (2 * SPIN_GAIN * jt) / r;
}

/** The right wall's grip, the mirror of the left. */
function rubRight(f: Fruit, r: number, press: number): void {
  const jt = surfaceGrip(f.vy + f.spin * r, press);
  f.vy += jt;
  if (!f.parked) f.spin += (2 * SPIN_GAIN * jt) / r;
}

/** The floor's grip, which is what turns a skid along the bottom of the jar into a roll. */
function rubFloor(f: Fruit, r: number, press: number): void {
  const jt = surfaceGrip(f.vx - f.spin * r, press);
  f.vx += jt;
  if (!f.parked) f.spin -= (2 * SPIN_GAIN * jt) / r;
}

/**
 * A fixed scatter for the orange's peel: same index, same dimple, every frame.
 *
 * Math.random() would put the texture somewhere new sixty times a second, which does not
 * read as a rough peel - it reads as static.
 */
function hash(i: number): number {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** The burst ring reuses the fruit's own colour, which is only given as hex. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
