import { CanvasWidget } from './types';

const COLS = 6;
const ROWS = 3;
const FLEET = COLS * ROWS;

/** Waves to clear for a win. Two is about a minute; three outstays a coffee. */
const WAVES = 2;
const LIVES = 3;

/**
 * Sprite grid, as a fraction of the box.
 *
 * Invaders are 8x5 cells and the ship is 7x4, so every sprite dimension follows from this
 * one number and the whole board scales with the widget.
 */
const CELL = 0.0095;
const INV_W = CELL * 8;
const INV_H = CELL * 5;
const SHIP_CELL = 0.0145;
const SHIP_W = SHIP_CELL * 7;
const SHIP_H = SHIP_CELL * 4;

const COL_STEP = 0.128;
const ROW_STEP = 0.085;
/** Clear space at each side, which is also where the fleet turns around. */
const MARGIN = 0.05;
const FLEET_TOP = 0.17;
/** Each wave after the first starts this much lower - less room, less time. */
const WAVE_DROP = 0.045;

const STEP_X = 0.022;
const STEP_Y = 0.036;
/**
 * Seconds between marches with the fleet full, scaled down in proportion to how many are
 * left. That acceleration is the whole drama of Space Invaders: the board gets faster
 * because you are winning, and the last one alive is genuinely hard to catch.
 */
const STEP_BASE = 0.5;
const STEP_MIN = 0.085;
/** Every wave after the first marches this much quicker at the same fleet size. */
const WAVE_SPEEDUP = 0.78;

const SHIP_Y = 0.88;
/** Ship travel per second under autopilot; the pointer is followed proportionally. */
const SHIP_SPEED = 0.85;

const BULLET_SPEED = 1.15;
const BULLET_W = 0.011;
const BULLET_H = 0.042;
/** Auto-fire cadence, and how many shots may be in flight. Two keeps up without spraying. */
const FIRE_INTERVAL = 0.4;
const MAX_BULLETS = 2;

const BOMB_SPEED = 0.44;
const BOMB_W = 0.013;
const BOMB_H = 0.032;
const BOMB_INTERVAL = 1.15;
const BOMB_JITTER = 0.7;

/** How long a lost life is held before the next one starts. */
const DEAD_PAUSE = 1.1;
/** Beat between clearing a wave and the next one arriving. */
const CLEAR_PAUSE = 1.2;
/** How long the result is held before handing over, so the run has an ending. */
const OVER_PAUSE = 1.8;

const BURST_LIFE = 0.45;

/**
 * The three invader shapes, top row first.
 *
 * Only the legs animate. That is how the arcade original did it, and it is the reason a
 * two-frame march reads as walking rather than as a sprite flickering between two
 * unrelated pictures.
 */
const SHAPES = [
  {
    colour: '196,181,253',
    body: ['..#..#..', '.######.', '##.##.##', '########'],
    legs: ['.#....#.', '#.#..#.#'],
  },
  {
    colour: '125,211,252',
    body: ['#..##..#', '.######.', '##.##.##', '########'],
    legs: ['.##..##.', '#.#..#.#'],
  },
  {
    colour: '134,239,172',
    body: ['..####..', '.######.', '##.##.##', '.######.'],
    legs: ['.#.##.#.', '#..##..#'],
  },
] as const;

const SHIP = ['...#...', '..###..', '#######', '##.#.##'] as const;

interface Invader {
  col: number;
  row: number;
  alive: boolean;
}

interface Shot {
  x: number;
  y: number;
}

interface Burst {
  x: number;
  y: number;
  t: number;
  colour: string;
}

type Phase = 'playing' | 'dead' | 'clear' | 'over';
type Result = 'win' | 'loss' | null;

/**
 * Space Invaders, played with the mouse alone.
 *
 * The two things a keyboard normally does here are move and shoot. Moving becomes the
 * pointer's x, which is strictly better than two keys. Shooting becomes automatic on a
 * fixed cadence, which sounds like it removes the game and does not: with the fire rate
 * fixed, *where the ship is standing* is the entire decision, and that is exactly the
 * decision the mouse is good at making.
 *
 * A run is two waves or three lives, whichever comes first, and it plays itself until the
 * pointer arrives - a widget that fades in showing a still fleet reads as a screenshot.
 */
export class SpaceInvaders extends CanvasWidget {
  private invaders: Invader[] = [];
  private bullets: Shot[] = [];
  private bombs: Shot[] = [];
  private bursts: Burst[] = [];
  private fleetX = 0;
  private fleetY = 0;
  private dir = 1;
  private frame = 0;
  private stepTimer = 0;
  private fireTimer = 0;
  private bombTimer = 0;
  private wave = 1;
  private lives = LIVES;
  private score = 0;
  private shipX = 0;
  private pointerX: number | null = null;
  private phase: Phase = 'playing';
  private result: Result = null;
  private waitTimer = 0;
  private time = 0;

  private px(fraction: number): number {
    return fraction * this.size;
  }

  private get shipY(): number {
    return this.px(SHIP_Y);
  }

  protected init(): void {
    this.shipX = this.size / 2;
    this.pointerX = null;
    this.lives = LIVES;
    this.score = 0;
    this.wave = 1;
    this.result = null;
    this.bursts = [];
    this.time = 0;
    this.startWave();
  }

  private startWave(): void {
    this.invaders = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) this.invaders.push({ col, row, alive: true });
    }
    const fleetW = this.px(COL_STEP) * (COLS - 1) + this.px(INV_W);
    this.fleetX = (this.size - fleetW) / 2;
    this.fleetY = this.px(FLEET_TOP + WAVE_DROP * (this.wave - 1));
    this.dir = 1;
    this.frame = 0;
    this.bullets = [];
    this.bombs = [];
    this.stepTimer = this.stepInterval();
    this.fireTimer = FIRE_INTERVAL;
    this.armBomb();
    this.phase = 'playing';
  }

  private get alive(): number {
    let n = 0;
    for (const inv of this.invaders) if (inv.alive) n++;
    return n;
  }

  private stepInterval(): number {
    const share = this.alive / FLEET;
    const wave = Math.pow(WAVE_SPEEDUP, this.wave - 1);
    return Math.max(STEP_MIN, STEP_BASE * share * wave);
  }

  private armBomb(): void {
    const jitter = (Math.random() - 0.5) * BOMB_JITTER;
    this.bombTimer = (BOMB_INTERVAL + jitter) * Math.pow(WAVE_SPEEDUP, this.wave - 1);
  }

  private invaderX(inv: Invader): number {
    return this.fleetX + inv.col * this.px(COL_STEP);
  }

  private invaderY(inv: Invader): number {
    return this.fleetY + inv.row * this.px(ROW_STEP);
  }

  protected update(dt: number): void {
    this.time += dt;
    this.ageBursts(dt);

    if (this.phase === 'over') {
      this.overStep(dt);
      return;
    }

    this.moveShip(dt);

    if (this.phase === 'dead' || this.phase === 'clear') {
      this.waitTimer -= dt;
      if (this.waitTimer > 0) return;
      if (this.phase === 'dead') this.respawn();
      else this.nextWave();
      return;
    }

    this.march(dt);
    this.fire(dt);
    this.dropBombs(dt);
    this.moveShots(dt);
    this.hitInvaders();
    this.hitShip();
    this.checkWave();
  }

  private overStep(dt: number): void {
    this.waitTimer += dt;
    if (this.waitTimer >= OVER_PAUSE) this.finish();
  }

  /**
   * Where the autopilot wants to stand: under the invader it is most useful to shoot.
   *
   * Lowest row first, because the fleet is a wall that descends and the bottom row is what
   * ends the run. Within that it takes the nearest, so it does not sprint across the board
   * past targets it could have hit on the way.
   */
  private autoTarget(): number | null {
    let best: Invader | null = null;
    let bestScore = -Infinity;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const score = inv.row * 1000 - Math.abs(this.invaderX(inv) + this.px(INV_W) / 2 - this.shipX);
      if (score > bestScore) {
        bestScore = score;
        best = inv;
      }
    }
    return best ? this.invaderX(best) + this.px(INV_W) / 2 : null;
  }

  /** A bomb close enough overhead that standing still is a bad idea. */
  private incoming(): Shot | null {
    const reach = this.px(SHIP_W) * 0.8;
    for (const b of this.bombs) {
      if (b.y < this.shipY - this.px(0.45)) continue;
      if (Math.abs(b.x - this.shipX) < reach) return b;
    }
    return null;
  }

  private moveShip(dt: number): void {
    const half = this.px(SHIP_W) / 2;
    const min = this.px(MARGIN) + half;
    const max = this.size - this.px(MARGIN) - half;

    if (this.pointerX !== null) {
      // Proportional follow, not a hard snap: a jittery hand shouldn't jitter the ship.
      this.shipX += (this.pointerX - this.shipX) * Math.min(1, dt * 16);
    } else {
      const dodge = this.incoming();
      // Sidestepping beats aiming when something is about to land on you - and an
      // autopilot that never dodges spends the whole run watching itself explode.
      const target = dodge
        ? this.shipX + (dodge.x < this.shipX ? this.px(0.2) : -this.px(0.2))
        : (this.autoTarget() ?? this.size / 2);
      const step = this.px(SHIP_SPEED) * dt;
      const delta = target - this.shipX;
      this.shipX += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
    }

    this.shipX = Math.max(min, Math.min(max, this.shipX));
  }

  /**
   * The fleet moves in discrete steps rather than continuously.
   *
   * Sliding smoothly is easier to write and wrong: the lurch, and the legs swapping on
   * each lurch, is what Space Invaders looks like. A fleet gliding across the screen is a
   * screensaver.
   */
  private march(dt: number): void {
    this.stepTimer -= dt;
    if (this.stepTimer > 0) return;
    this.stepTimer = this.stepInterval();
    this.frame ^= 1;

    let left = Infinity;
    let right = -Infinity;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      left = Math.min(left, this.invaderX(inv));
      right = Math.max(right, this.invaderX(inv) + this.px(INV_W));
    }
    if (left === Infinity) return;

    const step = this.dir * this.px(STEP_X);
    if (left + step < this.px(MARGIN) || right + step > this.size - this.px(MARGIN)) {
      this.dir = -this.dir;
      this.fleetY += this.px(STEP_Y);
      return;
    }
    this.fleetX += step;
  }

  private fire(dt: number): void {
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    this.fireTimer = FIRE_INTERVAL;
    if (this.bullets.length >= MAX_BULLETS) return;
    this.bullets.push({ x: this.shipX, y: this.shipY - this.px(BULLET_H) });
  }

  private dropBombs(dt: number): void {
    this.bombTimer -= dt;
    if (this.bombTimer > 0) return;
    this.armBomb();

    // Only the bottom invader in a column may bomb - anything else would have to shoot
    // through its own fleet, and you would watch it happen.
    const front = new Map<number, Invader>();
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const held = front.get(inv.col);
      if (!held || inv.row > held.row) front.set(inv.col, inv);
    }
    const shooters = [...front.values()];
    if (shooters.length === 0) return;

    const inv = shooters[Math.floor(Math.random() * shooters.length) % shooters.length]!;
    this.bombs.push({
      x: this.invaderX(inv) + this.px(INV_W) / 2,
      y: this.invaderY(inv) + this.px(INV_H),
    });
  }

  private moveShots(dt: number): void {
    for (const b of this.bullets) b.y -= this.px(BULLET_SPEED) * dt;
    this.bullets = this.bullets.filter((b) => b.y + this.px(BULLET_H) > 0);

    for (const b of this.bombs) b.y += this.px(BOMB_SPEED) * dt;
    this.bombs = this.bombs.filter((b) => b.y < this.size);
  }

  private hitInvaders(): void {
    const w = this.px(INV_W);
    const h = this.px(INV_H);
    const bw = this.px(BULLET_W);
    const bh = this.px(BULLET_H);

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      for (const inv of this.invaders) {
        if (!inv.alive) continue;
        const x = this.invaderX(inv);
        const y = this.invaderY(inv);
        if (b.x + bw / 2 < x || b.x - bw / 2 > x + w) continue;
        if (b.y > y + h || b.y + bh < y) continue;

        inv.alive = false;
        this.score++;
        this.bursts.push({
          x: x + w / 2,
          y: y + h / 2,
          t: 0,
          colour: SHAPES[inv.row % SHAPES.length]!.colour,
        });
        this.bullets.splice(i, 1);
        // Killing one speeds the whole fleet up, so the timer has to be re-derived now
        // rather than at the next step - otherwise the acceleration lags a full march.
        this.stepTimer = Math.min(this.stepTimer, this.stepInterval());
        break;
      }
    }
  }

  private hitShip(): void {
    const half = this.px(SHIP_W) / 2;
    const bw = this.px(BOMB_W);
    const bh = this.px(BOMB_H);

    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]!;
      if (b.x + bw / 2 < this.shipX - half || b.x - bw / 2 > this.shipX + half) continue;
      if (b.y + bh < this.shipY || b.y > this.shipY + this.px(SHIP_H)) continue;
      this.bombs.splice(i, 1);
      this.die();
      return;
    }

    // The fleet landing is the other way to lose, and it is not survivable - there is
    // nowhere left to stand, so spending a life on it would just replay the same frame.
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      if (this.invaderY(inv) + this.px(INV_H) < this.shipY) continue;
      this.lives = 0;
      this.die();
      return;
    }
  }

  private die(): void {
    this.bursts.push({
      x: this.shipX,
      y: this.shipY + this.px(SHIP_H) / 2,
      t: 0,
      colour: '253,186,116',
    });
    // Shots in flight go with the ship. Leaving a bomb hanging in the air through the
    // pause reads as the frame having frozen rather than as a beat.
    this.bombs = [];
    this.bullets = [];
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives <= 0) {
      this.result = 'loss';
      this.phase = 'over';
      this.waitTimer = 0;
      return;
    }
    this.phase = 'dead';
    this.waitTimer = DEAD_PAUSE;
  }

  /** Back on the board with the fleet where it stood; only the shots are cleared. */
  private respawn(): void {
    this.bombs = [];
    this.bullets = [];
    this.fireTimer = FIRE_INTERVAL;
    this.armBomb();
    this.phase = 'playing';
  }

  private checkWave(): void {
    if (this.alive > 0) return;
    if (this.wave >= WAVES) {
      this.result = 'win';
      this.phase = 'over';
      this.waitTimer = 0;
      return;
    }
    this.phase = 'clear';
    this.waitTimer = CLEAR_PAUSE;
    this.bombs = [];
  }

  private nextWave(): void {
    this.wave++;
    this.startWave();
  }

  private ageBursts(dt: number): void {
    let kept = 0;
    for (const b of this.bursts) {
      b.t += dt / BURST_LIFE;
      if (b.t < 1) this.bursts[kept++] = b;
    }
    this.bursts.length = kept;
  }

  protected draw(): void {
    this.drawInvaders();
    this.drawShots();
    this.drawBursts();
    // The ship is absent exactly while it is blown up: through the pause after a lost
    // life, and for good once the last one is spent.
    if (this.phase !== 'dead' && this.result !== 'loss') this.drawShip();
    this.drawGround();
    this.drawHud();
    if (this.phase === 'over') this.drawResult();
  }

  private drawInvaders(): void {
    const ctx = this.ctx;
    const cell = this.px(CELL);
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const shape = SHAPES[inv.row % SHAPES.length]!;
      ctx.fillStyle = `rgba(${shape.colour},0.95)`;
      sprite(ctx, [...shape.body, shape.legs[this.frame]!], this.invaderX(inv), this.invaderY(inv), cell);
    }
  }

  private drawShip(): void {
    const ctx = this.ctx;
    const cell = this.px(SHIP_CELL);
    ctx.fillStyle = 'rgba(226,232,240,0.96)';
    sprite(ctx, SHIP, this.shipX - this.px(SHIP_W) / 2, this.shipY, cell);
  }

  private drawShots(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(224,242,254,0.95)';
    for (const b of this.bullets) {
      ctx.fillRect(b.x - this.px(BULLET_W) / 2, b.y, this.px(BULLET_W), this.px(BULLET_H));
    }

    // Bombs wiggle as they fall, which is both how the original drew them and the reason
    // they are readable against a fleet of the same size moving the other way.
    const w = this.px(BOMB_W);
    const h = this.px(BOMB_H);
    ctx.fillStyle = 'rgba(251,146,60,0.95)';
    for (const b of this.bombs) {
      const sway = Math.sin(b.y * 0.35) * w * 0.5;
      ctx.fillRect(b.x - w / 2 + sway, b.y, w * 0.6, h / 2);
      ctx.fillRect(b.x - w / 2 - sway, b.y + h / 2, w * 0.6, h / 2);
    }
  }

  private drawBursts(): void {
    const ctx = this.ctx;
    for (const b of this.bursts) {
      const fade = 1 - b.t;
      const r = this.px(0.012) + this.px(0.05) * b.t;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${b.colour},${0.8 * fade})`;
      ctx.lineWidth = Math.max(1, this.px(0.01) * fade);
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        ctx.moveTo(b.x + Math.cos(a) * r * 0.6, b.y + Math.sin(a) * r * 0.6);
        ctx.lineTo(b.x + Math.cos(a) * r * 1.25, b.y + Math.sin(a) * r * 1.25);
      }
      ctx.stroke();
    }
  }

  /** The line the fleet must not cross, which is also the ship's floor. */
  private drawGround(): void {
    const ctx = this.ctx;
    const y = this.shipY + this.px(SHIP_H) + this.px(0.012);
    ctx.beginPath();
    ctx.moveTo(this.px(MARGIN), y);
    ctx.lineTo(this.size - this.px(MARGIN), y);
    ctx.strokeStyle = 'rgba(125,211,252,0.35)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /** Lives on the left, waves on the right, score between them. */
  private drawHud(): void {
    const ctx = this.ctx;
    const r = this.px(0.016);
    const y = this.px(0.07);

    for (let i = 0; i < LIVES; i++) {
      ctx.beginPath();
      ctx.arc(this.px(0.07) + i * r * 3, y, r, 0, Math.PI * 2);
      ctx.fillStyle = i < this.lives ? 'rgba(226,232,240,0.95)' : 'rgba(148,163,184,0.28)';
      ctx.fill();
    }

    for (let i = 0; i < WAVES; i++) {
      ctx.beginPath();
      ctx.arc(this.size - this.px(0.07) - i * r * 3, y, r, 0, Math.PI * 2);
      // A wave is only banked once it has been cleared, so the current one stays hollow.
      const cleared = i < this.wave - 1 || (this.result === 'win' && i < WAVES);
      ctx.fillStyle = cleared ? 'rgba(134,239,172,0.95)' : 'rgba(148,163,184,0.28)';
      ctx.fill();
    }

    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `600 ${Math.round(this.px(0.06))}px system-ui, sans-serif`;
    ctx.fillText(String(this.score), this.size / 2, y);
    ctx.restore();
  }

  private drawResult(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle =
      this.result === 'win' ? 'rgba(134,239,172,0.95)' : 'rgba(248,113,113,0.95)';
    ctx.font = `600 ${Math.round(this.px(0.085))}px system-ui, sans-serif`;
    ctx.fillText(this.result === 'win' ? 'earth saved' : 'game over', this.size / 2, this.size / 2);
    ctx.restore();
  }

  override onPointerDown(x: number): void {
    this.pointerX = x;
  }

  /** Hover steers - the ship fires itself, so a held button would buy nothing. */
  override onPointerMove(x: number): void {
    this.pointerX = x;
  }
}

/**
 * Blit a '#' bitmap as rectangles, merging horizontal runs.
 *
 * Half a pixel of bleed on each rect: exact cells leave hairline gaps between neighbours
 * once the canvas is scaled by a fractional device pixel ratio.
 */
function sprite(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  cell: number,
): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    let c = 0;
    while (c < row.length) {
      if (row[c] !== '#') {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < row.length && row[end] === '#') end++;
      ctx.fillRect(x + c * cell, y + r * cell, (end - c) * cell + 0.5, cell + 0.5);
      c = end;
    }
  }
}
