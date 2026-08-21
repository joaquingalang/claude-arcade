import { CanvasWidget, type ArrowKey } from './types';

/**
 * Tetris, on the arrow keys or on the mouse alone.
 *
 * Arrows are what this is actually played with, so it asks for them the way Snake does -
 * see `main/keyboard.ts` for what taking them off the desktop costs, and why the widget
 * has to keep working without them. Left and right walk a column, up turns, down is a
 * soft drop for as long as it is held.
 *
 * The mouse scheme is not a fallback bolted on afterwards; it is the one this was built
 * around and it stays complete. Moving is where the pointer is: the piece tracks the
 * column under it, a column at a time rather than by teleporting, so it still has to get
 * past what is already stacked. Turning and dropping share the button and are told apart
 * by how long it is held: a tap turns the piece, a press held past a tap is a soft drop
 * for as long as you hold it. That split is what makes the scheme work at all - the two
 * are never wanted at the same instant, and holding for a drop is the gesture you already
 * make when you have decided where the piece goes.
 *
 * Whichever input was used last is in charge, and a run opens with a legend saying which
 * ones there are - drawn from what main says the arrows will actually do, so a desk that
 * turned the grab off is never taught a control that does nothing.
 *
 * A run ends one way: the stack reaches the top. There is no target to survive to, so the
 * escalation is what has to end it - the fall gets quicker with every level and never
 * stops getting quicker, until it is quicker than anybody can steer against. It plays
 * itself until the pointer arrives, one-piece lookahead over every rotation and column,
 * scored the way the old Tetris solvers score it.
 */

const COLS = 10;
const ROWS = 16;

/** Layout, as fractions of the box's square. The well on the left, the panel beside it. */
const CELL = 0.0525;
const WELL_X = 0.045;
const WELL_Y = 0.115;
const PANEL_X = 0.63;
const PANEL_W = 0.325;
const NEXT_Y = 0.17;
const NEXT_CELL = 0.036;
const COUNT_Y = 0.5;
const LEVEL_Y = 0.62;
const BAR_Y = 0.71;
const BAR_H = 0.022;

/**
 * Seconds per row on level one, and the fraction of that a level takes off.
 *
 * No floor under it, on purpose. Every other number here could be tuned; this one is what
 * makes the game end at all, and a floor is a difficulty the run can settle at - which
 * against an autopilot that places pieces better than either of us means a widget still on
 * screen when you look up an hour later. Gravity moves at most one row a frame, so the
 * frame rate is the only floor there is, and reaching it is the ending.
 */
const FALL_START = 0.42;
const FALL_DECAY = 0.84;
/**
 * What buys a level: this many seconds of play, or this many lines. They add rather than
 * race, so a good run climbs on both counts.
 *
 * Lines alone is the rule everyone else uses and on its own it is the rule that lets this
 * go on all afternoon: a stack kept flat and never cleared never speeds up, which is
 * precisely what the autopilot does when nobody is here. The clock is what guarantees the
 * ending; the lines are what make playing well cost something.
 */
const LEVEL_SECONDS = 5;
const LEVEL_LINES = 3;
/** Seconds per row while the button is held down, and while the autopilot is lined up. */
const SOFT_INTERVAL = 0.04;
/**
 * Grace between landing on something and locking.
 *
 * Deliberately not renewed by sliding sideways, only by managing to fall another row.
 * Renewing it on movement is the usual rule and it lets a piece be walked along the floor
 * forever, which under a pointer that is always nudging the piece is not a trick, it is
 * the default.
 */
const LOCK_DELAY = 0.22;
/** How long a full row is held lit before the stack comes down. */
const CLEAR_SECONDS = 0.3;
/** How long the result is held before handing over, so the run has an ending. */
const OVER_PAUSE = 1.8;

/** Longest a press can be and still count as a tap - past this it is a drop, not a turn. */
const TAP_SECONDS = 0.18;
/**
 * How long one press of the down arrow keeps the fall fast.
 *
 * A global accelerator repeats at the desktop's key-repeat rate, which is a lazier tick
 * than a drop should feel and differs from machine to machine. So a press buys a moment
 * of speed rather than exactly one row: hold the key and the repeats overlap into a
 * continuous drop, let go and it is back to the normal fall within a fifth of a second.
 */
const SOFT_HOLD = 0.16;
/** Seconds per column of pointer steering, and of the autopilot lining a piece up. */
const STEER_STEP = 0.045;
const AUTO_STEP = 0.075;

/** How long the legend stays up at the start of a run, and how long it takes to go. */
const GUIDE_SECONDS = 2.6;
const GUIDE_FADE = 0.7;
/** Where the legend sits: low, where the stack cannot have reached in its first breath. */
const GUIDE_Y = 0.74;

/**
 * How a placement is scored, once the piece has landed and any full rows are gone.
 *
 * The weights are the well-known ones: clearing is worth something, but height, buried
 * holes and a jagged surface are each worth more against you, which is why the autopilot
 * keeps the stack flat and refuses to roof over a gap for one line.
 */
const W_LINES = 0.76;
const W_HEIGHT = 0.51;
const W_HOLES = 0.36;
const W_BUMPS = 0.18;

interface Cell {
  x: number;
  y: number;
}

/**
 * The seven pieces, each in the smallest box its rotations turn inside.
 *
 * The box is what makes rotation a two-line affair rather than a table: turning a piece is
 * turning its box, and the box size is the only thing that differs between an I that
 * sweeps four columns and an O that must not move at all.
 */
const PIECES: Array<{ box: number; colour: string; cells: Cell[] }> = [
  {
    box: 4,
    colour: '125,211,252',
    cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
  },
  {
    box: 3,
    colour: '129,140,248',
    cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  },
  {
    box: 3,
    colour: '251,146,60',
    cells: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  },
  {
    box: 2,
    colour: '253,224,71',
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  },
  {
    box: 3,
    colour: '134,239,172',
    cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  },
  {
    box: 3,
    colour: '196,181,253',
    cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  },
  {
    box: 3,
    colour: '248,113,113',
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  },
];

/** Every rotation of every piece, worked out once: a quarter turn is (x,y) -> (n-1-y, x). */
export const ROTATIONS: Cell[][][] = PIECES.map((piece) => {
  const states: Cell[][] = [piece.cells];
  for (let r = 1; r < 4; r++) {
    states.push(states[r - 1]!.map((c) => ({ x: piece.box - 1 - c.y, y: c.x })));
  }
  return states;
});

/** Sideways nudges tried when a turn does not fit where the piece stands. */
const KICKS = [0, -1, 1, -2, 2];

type Phase = 'play' | 'clearing' | 'over';
/** Whichever input was used last is in charge, and it opens on autopilot. */
type Mode = 'auto' | 'pointer' | 'keys';

export class Tetris extends CanvasWidget {
  /** The stack, row by row: the piece index that filled a cell, or -1 for empty. */
  private board: number[] = [];
  /** The shuffle bag, so all seven pieces come up once before any comes up twice. */
  private bag: number[] = [];
  private kind = 0;
  private rot = 0;
  private col = 0;
  private row = 0;
  private next = 0;
  /** Where the autopilot means to put the piece, or null while a person is playing. */
  private plan: { rot: number; col: number } | null = null;
  private fallTimer = 0;
  private lockTimer = 0;
  private stepTimer = 0;
  private clearing: number[] = [];
  private clearTimer = 0;
  private lines = 0;
  /** Seconds of play behind this run, which is half of what sets the speed. */
  private elapsed = 0;
  private overTimer = 0;
  private phase: Phase = 'play';
  private mode: Mode = 'auto';
  private pointerX: number | null = null;
  private pressed = false;
  private pressT = 0;
  /** Seconds of fast fall still owed to the down arrow. */
  private softUntil = 0;
  /** Seconds the opening legend has left. */
  private guide = 0;
  private cell = 0;
  private originX = 0;
  private originY = 0;

  protected init(): void {
    this.cell = this.size * CELL;
    this.originX = this.fx(WELL_X);
    this.originY = this.fy(WELL_Y);
    this.board = new Array<number>(COLS * ROWS).fill(-1);
    this.bag = [];
    this.lines = 0;
    this.elapsed = 0;
    this.phase = 'play';
    this.mode = 'auto';
    this.pointerX = null;
    this.pressed = false;
    this.pressT = 0;
    this.softUntil = 0;
    this.guide = GUIDE_SECONDS;
    this.clearing = [];
    this.overTimer = 0;
    this.next = this.pull();
    this.spawn();
  }

  /**
   * The next piece out of the bag.
   *
   * A bag rather than a die, for the reason the widget rotation uses one: seven straight
   * draws can hand you four S pieces and no I, and a run lost to that is a run lost to
   * nothing you did.
   */
  private pull(): number {
    if (this.bag.length === 0) {
      this.bag = PIECES.map((_, i) => i);
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
      }
    }
    return this.bag.pop()!;
  }

  private spawn(): void {
    this.kind = this.next;
    this.next = this.pull();
    this.rot = 0;
    this.col = Math.floor((COLS - PIECES[this.kind]!.box) / 2);
    this.row = 0;
    this.fallTimer = 0;
    this.lockTimer = LOCK_DELAY;
    this.stepTimer = 0;
    // No room for the piece it is holding is the only way this ends, and there is nothing
    // to play out afterwards - the well is full at the point it is full.
    if (this.hits(this.rot, this.col, this.row)) {
      this.over();
      return;
    }
    this.plan = this.mode === 'auto' ? this.bestPlacement() : null;
  }

  /** Whether the piece in that rotation overlaps a wall, the floor, or the stack. */
  private hits(rot: number, col: number, row: number): boolean {
    for (const c of ROTATIONS[this.kind]![rot]!) {
      const x = col + c.x;
      const y = row + c.y;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && this.board[y * COLS + x] !== -1) return true;
    }
    return false;
  }

  /**
   * How hard the game is leaning on you, as a number whose whole part is the level.
   *
   * Kept as one continuous quantity rather than a counter that gets bumped, because the
   * panel wants the fraction as much as the level does: a bar filling towards the next
   * step is the only warning the player gets that the floor is about to move.
   */
  private get pressure(): number {
    return this.elapsed / LEVEL_SECONDS + this.lines / LEVEL_LINES;
  }

  private get level(): number {
    return Math.floor(this.pressure);
  }

  private interval(): number {
    // Stepped by level rather than eased with pressure: a speed that drifts is a speed
    // nobody notices changing, and the point of the escalation is to be felt.
    const fall = FALL_START * Math.pow(FALL_DECAY, this.level);
    // The lesser of the two, not SOFT_INTERVAL flat: a dozen levels in, the ordinary fall
    // is already quicker than a soft drop, and a drop key that slowed the piece down would
    // read as a stuck button.
    const soft = Math.min(SOFT_INTERVAL, fall);
    if (this.softUntil > 0) return soft;
    if (this.pressed && this.pressT >= TAP_SECONDS) return soft;
    if (this.plan && this.plan.rot === this.rot && this.plan.col === this.col) return soft;
    return fall;
  }

  protected update(dt: number): void {
    if (this.pressed) this.pressT += dt;
    if (this.softUntil > 0) this.softUntil = Math.max(0, this.softUntil - dt);
    // Runs through every phase, so a legend is never left frozen on a finished board.
    if (this.guide > 0) this.guide = Math.max(0, this.guide - dt);

    // Counted through a clear as well as through play, since a row still coming down is
    // still the run, and stopped at the ending so a finished board does not go on levelling
    // up in front of you.
    if (this.phase !== 'over') this.elapsed += dt;

    if (this.phase === 'over') {
      this.overTimer += dt;
      if (this.overTimer >= OVER_PAUSE) this.finish();
      return;
    }
    if (this.phase === 'clearing') {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this.collapse();
      return;
    }

    this.steer(dt);
    this.gravity(dt);
  }

  /** A column of sideways movement at a time, from whichever hand is on the piece. */
  private steer(dt: number): void {
    // Keys move the piece the instant they arrive; there is nothing to walk towards.
    if (this.mode === 'keys') return;
    this.stepTimer -= dt;
    if (this.stepTimer > 0) return;

    if (this.mode === 'pointer') {
      this.stepTimer = STEER_STEP;
      const want = this.targetColumn();
      if (want !== null && want !== this.col) this.shift(Math.sign(want - this.col));
      return;
    }

    this.stepTimer = AUTO_STEP;
    const plan = this.plan;
    if (!plan) return;
    if (plan.rot !== this.rot) this.spin();
    else if (plan.col !== this.col) this.shift(Math.sign(plan.col - this.col));
  }

  /**
   * The column the piece should sit in for the pointer to be over its middle.
   *
   * Its middle, not its left edge: a piece that hangs off to one side of the cursor is a
   * piece you aim by feel rather than by looking, and the whole reason the pointer is
   * worth using here is that you can point straight at the gap.
   */
  private targetColumn(): number | null {
    if (this.pointerX === null) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const c of ROTATIONS[this.kind]![this.rot]!) {
      min = Math.min(min, c.x);
      max = Math.max(max, c.x);
    }
    const want = Math.round((this.pointerX - this.originX) / this.cell - (min + max + 1) / 2);
    return Math.max(-min, Math.min(COLS - 1 - max, want));
  }

  private shift(dx: number): void {
    if (!this.hits(this.rot, this.col + dx, this.row)) this.col += dx;
  }

  private spin(): void {
    const rot = (this.rot + 1) % 4;
    // Nudged sideways rather than refused: against a wall or a ledge, a turn that would
    // fit one column over is the turn that was meant.
    for (const kick of KICKS) {
      if (this.hits(rot, this.col + kick, this.row)) continue;
      this.rot = rot;
      this.col += kick;
      return;
    }
  }

  private gravity(dt: number): void {
    if (!this.hits(this.rot, this.col, this.row + 1)) {
      this.lockTimer = LOCK_DELAY;
      this.fallTimer += dt;
      if (this.fallTimer < this.interval()) return;
      this.fallTimer = 0;
      this.row++;
      return;
    }

    this.fallTimer = 0;
    this.lockTimer -= dt;
    if (this.lockTimer <= 0) this.lock();
  }

  private lock(): void {
    for (const c of ROTATIONS[this.kind]![this.rot]!) {
      this.board[(this.row + c.y) * COLS + this.col + c.x] = this.kind;
    }

    const full: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      let filled = true;
      for (let c = 0; c < COLS; c++) {
        if (this.board[r * COLS + c] === -1) {
          filled = false;
          break;
        }
      }
      if (filled) full.push(r);
    }
    if (full.length === 0) {
      this.spawn();
      return;
    }

    this.clearing = full;
    this.clearTimer = CLEAR_SECONDS;
    this.phase = 'clearing';
  }

  private collapse(): void {
    // Top down, one cleared row at a time, so the rows above each one fall into it - the
    // same reason you cannot just filter the board and pad the top when several go at once.
    for (const cleared of this.clearing) {
      for (let r = cleared; r > 0; r--) {
        for (let c = 0; c < COLS; c++) this.board[r * COLS + c] = this.board[(r - 1) * COLS + c]!;
      }
      for (let c = 0; c < COLS; c++) this.board[c] = -1;
    }

    this.lines += this.clearing.length;
    this.clearing = [];
    this.phase = 'play';
    this.spawn();
  }

  private over(): void {
    this.phase = 'over';
    this.overTimer = 0;
  }

  /** Where the piece would come to rest in a given rotation and column. */
  private landing(rot: number, col: number): number {
    let row = this.row;
    while (!this.hits(rot, col, row + 1)) row++;
    return row;
  }

  /**
   * The autopilot's choice: every rotation in every column, dropped and scored.
   *
   * One piece deep. Looking at the next one too is the obvious improvement and it is not
   * worth it here - a widget that plays perfectly never reaches its own ending, and the
   * point of the autopilot is to show what the game looks like, not to win it.
   */
  private bestPlacement(): { rot: number; col: number } | null {
    let best: { rot: number; col: number } | null = null;
    let bestScore = -Infinity;

    for (let rot = 0; rot < 4; rot++) {
      for (let col = -2; col < COLS + 2; col++) {
        if (this.hits(rot, col, this.row)) continue;
        const score = this.rate(rot, col, this.landing(rot, col));
        if (score <= bestScore) continue;
        bestScore = score;
        best = { rot, col };
      }
    }
    return best;
  }

  private rate(rot: number, col: number, row: number): number {
    const grid = this.board.slice();
    for (const c of ROTATIONS[this.kind]![rot]!) grid[(row + c.y) * COLS + col + c.x] = this.kind;

    // Scored on the board as it would be *after* the clear, or every placement that fills
    // a row would be marked down for the height it is about to lose.
    const rows: number[][] = [];
    let cleared = 0;
    for (let r = 0; r < ROWS; r++) {
      const line: number[] = [];
      let full = true;
      for (let c = 0; c < COLS; c++) {
        const v = grid[r * COLS + c]!;
        line.push(v);
        if (v === -1) full = false;
      }
      if (full) cleared++;
      else rows.push(line);
    }
    while (rows.length < ROWS) rows.unshift(new Array<number>(COLS).fill(-1));

    let aggregate = 0;
    let holes = 0;
    let bumps = 0;
    const heights: number[] = [];
    for (let c = 0; c < COLS; c++) {
      let top = ROWS;
      for (let r = 0; r < ROWS; r++) {
        if (rows[r]![c] === -1) continue;
        top = r;
        break;
      }
      heights.push(ROWS - top);
      aggregate += ROWS - top;
      for (let r = top + 1; r < ROWS; r++) {
        if (rows[r]![c] === -1) holes++;
      }
    }
    for (let c = 1; c < COLS; c++) bumps += Math.abs(heights[c]! - heights[c - 1]!);

    return W_LINES * cleared - W_HEIGHT * aggregate - W_HOLES * holes - W_BUMPS * bumps;
  }

  private take(x: number): void {
    this.mode = 'pointer';
    this.plan = null;
    this.dismissGuide();
    this.pointerX = Math.max(this.originX, Math.min(this.originX + COLS * this.cell, x));
  }

  /**
   * An arrow key, forwarded from the main process's global accelerator.
   *
   * Taking the keyboard is itself the input, as in Snake: a press comes with "I am
   * driving now" attached whether or not it turns out to change anything, so the handover
   * happens before the key is looked at.
   */
  override onKey(key: ArrowKey): void {
    this.mode = 'keys';
    this.plan = null;
    this.pointerX = null;
    this.dismissGuide();
    if (this.phase !== 'play') return;

    if (key === 'Left') this.shift(-1);
    else if (key === 'Right') this.shift(1);
    else if (key === 'Up') this.spin();
    else this.softDrop();
  }

  /** A row now, and a moment of fast fall after it - see SOFT_HOLD. */
  private softDrop(): void {
    this.softUntil = SOFT_HOLD;
    if (this.hits(this.rot, this.col, this.row + 1)) return;
    this.row++;
    // Zeroed so the row just taken by hand is not also charged to gravity.
    this.fallTimer = 0;
  }

  /**
   * Put the legend away, because whoever is here has stopped needing it.
   *
   * Faded out rather than cut, and never extended: a legend that vanished on the frame
   * you touched the widget would read as something breaking.
   */
  private dismissGuide(): void {
    this.guide = Math.min(this.guide, GUIDE_FADE);
  }

  override onPointerDown(x: number): void {
    this.take(x);
    this.pressed = true;
    this.pressT = 0;
  }

  /** Hover steers, so the piece is already where you are looking before you commit. */
  override onPointerMove(x: number): void {
    this.take(x);
  }

  override onPointerUp(): void {
    // A tap turns the piece. A press held longer was a drop, and it has already happened -
    // turning it now would be answering an instruction from a second ago.
    if (this.pressed && this.pressT < TAP_SECONDS && this.phase === 'play') this.spin();
    this.pressed = false;
    this.pressT = 0;
  }

  private fx(fraction: number): number {
    return (this.width - this.size) / 2 + fraction * this.size;
  }

  private fy(fraction: number): number {
    return (this.height - this.size) / 2 + fraction * this.size;
  }

  protected draw(): void {
    this.drawWell();
    this.drawStack();
    if (this.phase === 'play') {
      this.drawGhost();
      this.drawPiece();
    }
    this.drawPanel();
    if (this.guide > 0) this.drawGuide();
    if (this.phase === 'over') this.drawResult();
  }

  private drawWell(): void {
    const ctx = this.ctx;
    const w = COLS * this.cell;
    const h = ROWS * this.cell;
    ctx.fillStyle = 'rgba(15,23,42,0.28)';
    ctx.fillRect(this.originX, this.originY, w, h);
    ctx.strokeStyle = 'rgba(148,163,184,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.originX, this.originY);
    ctx.lineTo(this.originX + w, this.originY);
    ctx.lineTo(this.originX + w, this.originY + h);
    ctx.lineTo(this.originX, this.originY + h);
    ctx.closePath();
    ctx.stroke();
  }

  private drawStack(): void {
    const flash = this.clearTimer / CLEAR_SECONDS;
    for (let r = 0; r < ROWS; r++) {
      const going = this.clearing.includes(r);
      for (let c = 0; c < COLS; c++) {
        const kind = this.board[r * COLS + c]!;
        if (kind === -1) continue;
        const x = this.originX + c * this.cell;
        const y = this.originY + r * this.cell;
        // A row on its way out goes white and fades, so the clear is something you watch
        // happen rather than a row that was there and then was not.
        if (going) this.block(x, y, this.cell, '255,255,255', Math.max(0, flash));
        else this.block(x, y, this.cell, PIECES[kind]!.colour);
      }
    }
  }

  private drawPiece(): void {
    const colour = PIECES[this.kind]!.colour;
    for (const c of ROTATIONS[this.kind]![this.rot]!) {
      const y = this.row + c.y;
      if (y < 0) continue;
      const x = this.originX + (this.col + c.x) * this.cell;
      this.block(x, this.originY + y * this.cell, this.cell, colour);
    }
  }

  /**
   * Where the piece will land, outlined.
   *
   * Not a nicety: aiming with a pointer means aiming at a column you are pointing at
   * rather than one you counted, and the ghost is what closes the gap between the two.
   */
  private drawGhost(): void {
    const ctx = this.ctx;
    const row = this.landing(this.rot, this.col);
    if (row === this.row) return;

    const inset = this.cell * 0.16;
    const side = this.cell - inset * 2;
    ctx.strokeStyle = `rgba(${PIECES[this.kind]!.colour},0.35)`;
    ctx.lineWidth = Math.max(1, this.cell * 0.08);
    ctx.beginPath();
    for (const c of ROTATIONS[this.kind]![this.rot]!) {
      const x = this.originX + (this.col + c.x) * this.cell + inset;
      const y = this.originY + (row + c.y) * this.cell + inset;
      ctx.moveTo(x, y);
      ctx.lineTo(x + side, y);
      ctx.lineTo(x + side, y + side);
      ctx.lineTo(x, y + side);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private block(x: number, y: number, size: number, colour: string, alpha = 1): void {
    const ctx = this.ctx;
    const inset = size * 0.06;
    ctx.fillStyle = `rgba(${colour},${0.92 * alpha})`;
    ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    // A lit top edge, which is all it takes for a flat square to read as a block.
    ctx.fillStyle = `rgba(255,255,255,${0.22 * alpha})`;
    ctx.fillRect(x + inset, y + inset, size - inset * 2, size * 0.16);
  }

  private drawPanel(): void {
    const ctx = this.ctx;
    const centre = this.fx(PANEL_X + PANEL_W / 2);
    const cell = NEXT_CELL * this.size;

    // The next piece, centred in the panel on its own occupied width rather than its box,
    // so an L and an I both look placed rather than one of them looking dropped.
    const cells = ROTATIONS[this.next]![0]!;
    let min = Infinity;
    let max = -Infinity;
    for (const c of cells) {
      min = Math.min(min, c.x);
      max = Math.max(max, c.x);
    }
    const left = centre - ((max - min + 1) * cell) / 2 - min * cell;
    for (const c of cells) {
      this.block(left + c.x * cell, this.fy(NEXT_Y) + c.y * cell, cell, PIECES[this.next]!.colour);
    }

    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226,232,240,0.92)';
    ctx.font = `600 ${Math.round(this.size * 0.085)}px system-ui, sans-serif`;
    ctx.fillText(String(this.lines), centre, this.fy(COUNT_Y));

    ctx.fillStyle = 'rgba(148,163,184,0.9)';
    ctx.font = `${Math.round(this.size * 0.045)}px system-ui, sans-serif`;
    ctx.fillText(`level ${this.level + 1}`, centre, this.fy(LEVEL_Y));
    ctx.restore();

    // How near the next level is. With no target to count towards, this bar is the only
    // thing on screen that says the game is about to get harder, which is worth more
    // warning than the speed change itself gives you.
    const w = PANEL_W * this.size * 0.8;
    const h = BAR_H * this.size;
    const x = centre - w / 2;
    const y = this.fy(BAR_Y);
    ctx.fillStyle = 'rgba(148,163,184,0.25)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(251,146,60,0.9)';
    ctx.fillRect(x, y, w * (this.pressure - this.level), h);
  }

  /**
   * The opening legend.
   *
   * Two schemes share this widget and neither is guessable from looking at it - nothing
   * on a Tetris board says "hold the button to drop" - so a run opens by saying so and
   * then gets out of the way. What it lists comes from `this.keyboard`, which is main's
   * answer about the arrow grab rather than this widget's assumption: promising arrows to
   * somebody who turned them off would be worse than saying nothing.
   *
   * It sits low, over the part of the well a stack cannot have reached this early, so the
   * piece the legend is describing stays visible while it is read.
   */
  private drawGuide(): void {
    const ctx = this.ctx;
    const fade = Math.min(1, this.guide / GUIDE_FADE);
    // Escaped rather than literal, because every other byte in this repo is ASCII:
    // left, right, up, down.
    const lines = this.keyboard
      ? ['\u2190 \u2192 move   \u2191 turn   \u2193 drop', 'or point, tap, hold']
      : ['point to move   tap to turn', 'hold to drop'];

    const x = this.fx(0.5);
    const y = this.fy(GUIDE_Y);
    const w = this.size * 0.92;
    const h = this.size * 0.155;
    const lead = this.size * 0.055;

    ctx.save();
    // A plain panel rather than a rounded one: `roundRect` is newer than the oldest
    // Chromium this has to run on, and at this size the corners are two pixels.
    ctx.fillStyle = `rgba(15,23,42,${0.72 * fade})`;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = `rgba(226,232,240,${0.95 * fade})`;
    ctx.font = `600 ${Math.round(this.size * 0.05)}px system-ui, sans-serif`;
    ctx.fillText(lines[0]!, x, y - lead / 2);

    ctx.fillStyle = `rgba(148,163,184,${0.9 * fade})`;
    ctx.font = `${Math.round(this.size * 0.042)}px system-ui, sans-serif`;
    ctx.fillText(lines[1]!, x, y + lead / 2);
    ctx.restore();
  }

  private drawResult(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The count is the ending, and with only one way to end there is nothing for a colour
    // to say about it - every run finishes topped out, so red would be scolding the player
    // for playing. It is a score, drawn as one, and anything wordier would cover the board
    // you want a last look at.
    ctx.fillStyle = 'rgba(226,232,240,0.95)';
    ctx.font = `600 ${Math.round(this.size * 0.075)}px system-ui, sans-serif`;
    ctx.fillText(
      `${this.lines} lines`,
      this.originX + (COLS * this.cell) / 2,
      this.originY + (ROWS * this.cell) / 2,
    );
    ctx.restore();
  }
}
