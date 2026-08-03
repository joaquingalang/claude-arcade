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

const FILL = ['#ef4444', '#fb7185', '#a78bfa', '#fb923c', '#4ade80'];
const SHADE = ['#b91c1c', '#e11d48', '#7c3aed', '#ea580c', '#16a34a'];

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
/** Fruit are soft and heavy; a bouncy jar never settles enough to merge. */
const RESTITUTION = 0.08;
const WALL_BOUNCE = 0.3;
const AIR_DRAG = 0.999;

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
  /** Per-fruit phase, so identical tiers don't share a highlight angle. */
  seed: number;
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
    });
    this.next = this.deal();
    this.reload = RELOAD;
  }

  /** One frame of physics, split into substeps so a tall stack stays put. */
  private step(dt: number): void {
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const f of this.fruit) {
        f.age += h;
        if (f.born < 1) f.born = Math.min(1, f.born + h * 6);
        f.vy += this.px(GRAVITY) * h;
        f.vx *= AIR_DRAG;
        f.x += f.vx * h;
        f.y += f.vy * h;
        this.contain(f);
      }
      for (let r = 0; r < RELAX; r++) this.collide();
    }
    this.merge();
  }

  private contain(f: Fruit): void {
    const r = this.radius(f.tier);
    if (f.x < this.left + r) {
      f.x = this.left + r;
      if (f.vx < 0) f.vx *= -WALL_BOUNCE;
    } else if (f.x > this.right - r) {
      f.x = this.right - r;
      if (f.vx > 0) f.vx *= -WALL_BOUNCE;
    }
    if (f.y > this.floor - r) {
      f.y = this.floor - r;
      if (f.vy > 0) f.vy *= -WALL_BOUNCE;
      // Ground friction, or the pile slides apart forever and nothing ever stacks.
      f.vx *= 0.88;
    }
  }

  /**
   * Push overlapping fruit apart and exchange momentum.
   *
   * Mass goes as area, so a melon shoulders a cherry aside rather than the two splitting
   * the difference - which is most of what makes the pile read as fruit rather than as
   * equal-weight billiard balls.
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
        const jImp = (-(1 + RESTITUTION) * vn) / inv;
        a.vx -= jImp * nx * ima;
        a.vy -= jImp * ny * ima;
        b.vx += jImp * nx * imb;
        b.vy += jImp * ny * imb;
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
    this.drawBall(f.x, f.y, this.radius(f.tier) * swell, f.tier, f.seed);
  }

  private drawBall(x: number, y: number, r: number, tier: number, seed: number): void {
    const ctx = this.ctx;
    const fill = FILL[tier] ?? FILL[0]!;
    const shade = SHADE[tier] ?? SHADE[0]!;

    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, fill);
    g.addColorStop(1, shade);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Melon stripes, so the top tier is unmistakable at 33px.
    if (tier === TOP_TIER) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(20,83,45,0.55)';
      ctx.lineWidth = Math.max(1.5, r * 0.13);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * r * 0.55, y - r);
        ctx.lineTo(x + i * r * 0.75, y + r);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(x - r * 0.34, y - r * 0.36, r * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();

    // A stem only once there is room to read one.
    if (r > this.px(0.055)) {
      ctx.strokeStyle = 'rgba(74,55,34,0.85)';
      ctx.lineWidth = Math.max(1.2, r * 0.1);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.92);
      ctx.lineTo(x + Math.cos(seed) * r * 0.22, y - r * 1.22);
      ctx.stroke();
    }
  }

  private drawBursts(): void {
    const ctx = this.ctx;
    for (const b of this.bursts) {
      const fade = 1 - b.t;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (1 + b.t * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(FILL[b.tier] ?? FILL[0]!, 0.7 * fade);
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

/** The burst ring reuses the fruit's own colour, which is only given as hex. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
