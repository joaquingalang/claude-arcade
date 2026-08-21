import { knock } from '../audio';
import { CanvasWidget } from './types';

/**
 * Connect Four, against a solver that is deliberately not the best one available.
 *
 * The pointer is the whole interface and always was: a column is a wide target, so this is
 * one of the few classics that loses nothing at all to a window that can never take a key.
 * Point at a column, click, watch it fall.
 *
 * **A hand arriving deals a fresh board**, which is Wordle's rule and it is here for a
 * near-identical reason. Connect Four is solved - the first player wins with perfect play -
 * so a position is never neutral, and being handed one mid-game means being handed a
 * verdict somebody else earned. Inheriting a board three moves from a forced loss is not
 * being given a game, it is being given the losing half of one. So the demo plays on and a
 * tap deals a clean grid instead, with the player moving first. The caption says so before
 * you touch it, so the reset is something you asked for rather than something that
 * happened.
 *
 * The tap that hands over still lands. The columns do not move between boards, so the
 * column under the cursor is the column you meant whichever grid was behind it, and your
 * disc drops there on the same click that cleared it.
 *
 * **The solver is handicapped on purpose.** `SEARCH_DEPTH` is five plies, which is enough
 * to take every win it is offered and refuse every one it is shown, and nowhere near
 * enough to play the opening correctly - a full-depth engine playing second is beatable
 * only by someone who has memorised the solution, and a game you cannot win is a game you
 * stop starting. `SLACK` is the other half: among moves the search rates within a few
 * points of each other it picks at random, so the demo is a different game every time and
 * two equal replies are an actual coin flip. The margin is far smaller than a three-in-a-
 * row is worth, and a decided position switches it off entirely - see `bestMove`, where
 * that turned out to matter more than it looks like it should.
 *
 * **Nothing to escalate.** The board holds forty-two discs and every move fills one, so
 * this reaches an ending whatever either side does - the same structural ceiling Wordle's
 * six guesses give it, and the reason neither game needs a difficulty ramp to be sure of
 * stopping. The one way out is a board somebody walked away from: games are exempt from
 * the cycle clock, so after `RESUME_SECONDS` untouched the solver takes the position back
 * and plays it out. It keeps the board rather than dealing a new one, because unlike the
 * hand-over case there is nobody left to treat unfairly.
 *
 * Sound is one knock per landing - the voice `Knock` was written for, its own comment
 * calls it a disc settling onto wood - off by default like everything else, and it carries
 * nothing the falling disc has not already said.
 */

export const COLS = 7;
export const ROWS = 6;
/** Discs in a row that wins. Named because the window builder and the check share it. */
const CONNECT = 4;

export type Player = 1 | 2;
export type Cell = 0 | Player;
/** Column-major, row 0 at the bottom - the order discs actually stack in. */
export type Board = Cell[];

export const RED: Player = 1;
export const YELLOW: Player = 2;

export function idx(col: number, row: number): number {
  return col * ROWS + row;
}

export function other(player: Player): Player {
  return player === RED ? YELLOW : RED;
}

export function emptyBoard(): Board {
  return new Array<Cell>(COLS * ROWS).fill(0);
}

/** How many discs are already in a column, which is also the row the next one lands in. */
export function heightOf(board: Board, col: number): number {
  let h = 0;
  while (h < ROWS && board[idx(col, h)] !== 0) h++;
  return h;
}

/**
 * Play a disc, returning the row it landed in, or -1 if the column is full or off the
 * board.
 *
 * Mutates, and the search undoes it by hand rather than copying - forty-two cells copied
 * at every node of a five-ply search is the difference between this running inside a frame
 * and not.
 */
export function dropInto(board: Board, col: number, player: Player): number {
  if (col < 0 || col >= COLS) return -1;
  const row = heightOf(board, col);
  if (row >= ROWS) return -1;
  board[idx(col, row)] = player;
  return row;
}

export function isFull(board: Board): boolean {
  for (let c = 0; c < COLS; c++) {
    if (heightOf(board, c) < ROWS) return false;
  }
  return true;
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/**
 * The winning line through a disc just played, or null.
 *
 * Only the last move can have completed a line, so this walks out from that one cell along
 * each of the four axes rather than scanning the board. It returns the cells rather than a
 * boolean because the win is drawn as well as scored, and a line of five - which a single
 * move can make - comes back whole, so the highlight never cuts a disc out of the middle
 * of something the player can plainly see.
 */
export function lineThrough(board: Board, col: number, row: number): number[] | null {
  const player = board[idx(col, row)];
  if (!player) return null;

  for (const [dc, dr] of DIRECTIONS) {
    const line = [idx(col, row)];
    for (const sign of [1, -1]) {
      let c = col + dc * sign;
      let r = row + dr * sign;
      while (c >= 0 && c < COLS && r >= 0 && r < ROWS && board[idx(c, r)] === player) {
        line.push(idx(c, r));
        c += dc * sign;
        r += dr * sign;
      }
    }
    if (line.length >= CONNECT) return line;
  }
  return null;
}

/**
 * Every four-in-a-row the board contains, worked out once.
 *
 * Sixty-nine of them, and the evaluation walks the whole list at each leaf. Built at load
 * rather than derived per call for the obvious reason, and kept as flat indices so the
 * inner loop is one array read per cell.
 */
const WINDOWS: number[][] = (() => {
  const out: number[][] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      for (const [dc, dr] of DIRECTIONS) {
        const lastC = c + dc * (CONNECT - 1);
        const lastR = r + dr * (CONNECT - 1);
        if (lastC < 0 || lastC >= COLS || lastR < 0 || lastR >= ROWS) continue;
        const window: number[] = [];
        for (let k = 0; k < CONNECT; k++) window.push(idx(c + dc * k, r + dr * k));
        out.push(window);
      }
    }
  }
  return out;
})();

/** What an unfinished threat is worth, and what sitting in the middle is worth. */
const TWO = 3;
const THREE = 32;
const CENTRE = 5;
/** Bigger than any heuristic total the board can reach, so a win always outranks one. */
const WIN = 100_000;

/**
 * The position from `player`'s side, in the same units `THREE` is quoted in.
 *
 * Antisymmetric by construction - `evaluate(b, RED) === -evaluate(b, YELLOW)` - which is
 * what lets the search negate a child's score rather than evaluate twice. A window holding
 * both colours is dead and scores nothing for either side, which is most of what makes
 * this better than counting discs.
 */
export function evaluate(board: Board, player: Player): number {
  const foe = other(player);
  let score = 0;

  for (const window of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const cell of window) {
      const v = board[cell]!;
      if (v === player) mine++;
      else if (v === foe) theirs++;
    }
    if (mine > 0 && theirs > 0) continue;
    if (mine === 3) score += THREE;
    else if (mine === 2) score += TWO;
    else if (theirs === 3) score -= THREE;
    else if (theirs === 2) score -= TWO;
  }

  // The centre column sits in more windows than any other, so a disc there is worth more
  // than the windows it has already filled say it is.
  const mid = Math.floor(COLS / 2);
  for (let r = 0; r < ROWS; r++) {
    const v = board[idx(mid, r)]!;
    if (v === player) score += CENTRE;
    else if (v === foe) score -= CENTRE;
  }
  return score;
}

/**
 * Columns tried centre-first.
 *
 * Pure alpha-beta economy: the best move is usually near the middle, and searching it
 * first is what makes most of the rest of the tree cut off unexamined.
 */
const ORDER: number[] = (() => {
  const mid = (COLS - 1) / 2;
  return Array.from({ length: COLS }, (_, c) => c).sort(
    (a, b) => Math.abs(a - mid) - Math.abs(b - mid),
  );
})();

/** Plies looked at. See the header for why this is five and not as many as will fit. */
export const SEARCH_DEPTH = 5;
/** How much worse than the best a move may rate and still be picked. */
export const SLACK = 12;

/**
 * Negamax with alpha-beta, scoring the position for whoever is to move.
 *
 * `ply` is subtracted from a win so that a mate in one outranks the same mate in three -
 * without it the search is content to postpone a won game forever, which looks exactly
 * like a bug and is one.
 */
function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  let best = -Infinity;
  let moves = 0;

  for (const col of ORDER) {
    const row = dropInto(board, col, player);
    if (row < 0) continue;
    moves++;

    let score: number;
    if (lineThrough(board, col, row) !== null) score = WIN - ply;
    else if (depth <= 1) score = evaluate(board, player);
    else score = -negamax(board, other(player), depth - 1, -beta, -alpha, ply + 1);

    board[idx(col, row)] = 0;

    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }

  // No legal move at all is a full board, which is a draw rather than a loss.
  return moves === 0 ? 0 : best;
}

/**
 * The column to play, or -1 on a full board.
 *
 * `random` is a parameter so a test can pin the choice down; the widget never passes one.
 */
export function bestMove(
  board: Board,
  player: Player,
  depth: number = SEARCH_DEPTH,
  random: () => number = Math.random,
): number {
  const scored: Array<{ col: number; score: number }> = [];

  for (const col of ORDER) {
    const row = dropInto(board, col, player);
    if (row < 0) continue;
    const score =
      lineThrough(board, col, row) !== null
        ? WIN
        : -negamax(board, other(player), depth - 1, -Infinity, Infinity, 1);
    board[idx(col, row)] = 0;
    scored.push({ col, score });
  }

  if (scored.length === 0) return -1;
  const best = Math.max(...scored.map((s) => s.score));

  // Slack is for choosing between moves that are genuinely close, and a decided position
  // is not close to anything. Ply-discounting puts a mate in one and a mate in three two
  // points apart, which is well inside the slack - so without this the solver would
  // happily take the slow win, and a solver that has a four on the board and plays
  // somewhere else looks exactly like one that cannot see it. Off the scale of any
  // heuristic total the board can reach, so it only ever catches a real mate.
  const decided = Math.abs(best) >= WIN - COLS * ROWS;
  const pool = scored.filter((s) => s.score >= best - (decided ? 0 : SLACK));
  return pool[Math.floor(random() * pool.length)]!.col;
}

/** Layout, as fractions of the box's square: a lane to fall from, the grid, a caption. */
const LANE_Y = 0.1;
const BOARD_Y = 0.175;
const CELL = 0.113;
const DISC = 0.046;
const CAPTION_Y = 0.945;

/** Seconds the solver appears to think, playing itself and replying to a player. */
const AUTO_THINK = 0.55;
const REPLY_THINK = 0.4;
/** How long the result is held before handing over, so the run has an ending. */
const OVER_PAUSE = 2.4;
/** How long a player's board waits for them before the solver finishes it. */
const RESUME_SECONDS = 20;

/** Fall acceleration, in squares per second squared, and what a bounce keeps of it. */
const GRAVITY = 11;
const BOUNCE = 0.26;
/** Below this impact speed a disc has arrived rather than bounced. */
const SETTLE = 0.9;

const RED_INK = '248,113,113';
const YELLOW_INK = '250,204,21';
const FRAME = '99,116,139';
const HOLE = '15,23,42';
const FACE = '148,163,184';
const INK = '226,232,240';

type Phase = 'thinking' | 'dropping' | 'over';
/** Whichever hand is on it, and it opens on its own. */
type Mode = 'auto' | 'player';
type Result = 'red' | 'yellow' | 'draw';

interface Falling {
  col: number;
  row: number;
  player: Player;
  y: number;
  vy: number;
}

export class ConnectFour extends CanvasWidget {
  private board: Board = emptyBoard();
  private turn: Player = RED;
  private mode: Mode = 'auto';
  private phase: Phase = 'thinking';
  private result: Result | null = null;
  /** The disc in the air. The board is not written until it lands. */
  private falling: Falling | null = null;
  private winLine: number[] | null = null;
  private thinkTimer = 0;
  private overTimer = 0;
  private idle = 0;
  private hover: number | null = null;
  private cell = 0;
  private boardLeft = 0;
  private boardTop = 0;

  protected init(): void {
    this.cell = CELL * this.size;
    this.boardLeft = this.fx(0.5) - (COLS * this.cell) / 2;
    this.boardTop = this.fy(BOARD_Y);
    this.mode = 'auto';
    this.hover = null;
    this.deal();
  }

  /** A clean grid with red to move. The geometry is laid out once and outlives this. */
  private deal(): void {
    this.board = emptyBoard();
    this.turn = RED;
    this.phase = 'thinking';
    this.result = null;
    this.falling = null;
    this.winLine = null;
    this.thinkTimer = AUTO_THINK;
    this.overTimer = 0;
    this.idle = 0;
  }

  protected update(dt: number): void {
    if (this.phase === 'over') {
      this.overTimer += dt;
      if (this.overTimer >= OVER_PAUSE) this.finish();
      return;
    }

    if (this.phase === 'dropping') {
      this.fall(dt);
      return;
    }

    if (this.mode === 'player') {
      this.idle += dt;
      if (this.idle >= RESUME_SECONDS) this.takeBack();
    }
    // A player's own turn is the one thing no clock in here runs down for them.
    if (this.mode === 'player' && this.turn === RED) return;

    this.thinkTimer -= dt;
    if (this.thinkTimer > 0) return;

    const col = bestMove(this.board, this.turn);
    if (col < 0) {
      this.settle('draw');
      return;
    }
    this.launch(col);
  }

  /**
   * The solver picking a board up again after a player put it down.
   *
   * The position stays exactly as it is - see the header. There is nobody left to hand a
   * lost game to, and throwing away the discs already played would waste the only part of
   * this the player did care about.
   */
  private takeBack(): void {
    this.mode = 'auto';
    this.thinkTimer = AUTO_THINK;
  }

  /** Start a disc down a column, from the lane above the grid. */
  private launch(col: number): void {
    const row = heightOf(this.board, col);
    if (row >= ROWS) return;
    this.falling = { col, row, player: this.turn, y: this.fy(LANE_Y), vy: 0 };
    this.phase = 'dropping';
  }

  private fall(dt: number): void {
    const disc = this.falling;
    if (!disc) {
      this.phase = 'thinking';
      return;
    }

    const floor = this.cellY(disc.row);
    disc.vy += GRAVITY * this.size * dt;
    disc.y += disc.vy * dt;
    if (disc.y < floor) return;

    disc.y = floor;
    if (disc.vy > SETTLE * this.size) {
      knock.tick(Math.min(1, disc.vy / (this.size * 6)));
      disc.vy = -disc.vy * BOUNCE;
      return;
    }

    knock.tick(0.35);
    this.land(disc);
  }

  /** A disc has arrived: write it, and see what that did. */
  private land(disc: Falling): void {
    this.board[idx(disc.col, disc.row)] = disc.player;
    this.falling = null;

    const line = lineThrough(this.board, disc.col, disc.row);
    if (line) {
      this.winLine = line;
      this.settle(disc.player === RED ? 'red' : 'yellow');
      return;
    }
    if (isFull(this.board)) {
      this.settle('draw');
      return;
    }

    this.turn = other(disc.player);
    this.phase = 'thinking';
    this.thinkTimer = this.mode === 'player' ? REPLY_THINK : AUTO_THINK;
  }

  private settle(result: Result): void {
    this.result = result;
    this.phase = 'over';
    this.overTimer = 0;
  }

  /**
   * The column under a pointer, or null.
   *
   * Coordinates arrive from outside the box as well as inside it, so the range check is
   * the point rather than a formality - an unclamped divide puts a click off the left edge
   * in column -2.
   */
  private columnAt(x: number): number | null {
    const col = Math.floor((x - this.boardLeft) / this.cell);
    if (col < 0 || col >= COLS) return null;
    return col;
  }

  override onPointerDown(x: number, _y: number): void {
    // The result is the ending; a press during it is somebody reaching for the next thing.
    if (this.phase === 'over') return;

    const col = this.columnAt(x);

    if (this.mode === 'auto') {
      // See the header: a position played out in front of you is not one you can be handed.
      this.deal();
      this.mode = 'player';
    }
    this.idle = 0;

    if (col === null) return;
    if (this.phase !== 'thinking' || this.turn !== RED) return;
    if (heightOf(this.board, col) >= ROWS) return;
    this.launch(col);
  }

  /**
   * Hover, which is what turns aiming at a column into pointing at one.
   *
   * The ghost disc it lights sits in the lane the real one falls from, so the answer to
   * "where would this go" is given in the place the disc will actually appear.
   */
  override onPointerMove(x: number, _y: number): void {
    this.hover = this.columnAt(x);
  }

  override onPointerUp(): void {
    this.idle = 0;
  }

  private fx(fraction: number): number {
    return (this.width - this.size) / 2 + fraction * this.size;
  }

  private fy(fraction: number): number {
    return (this.height - this.size) / 2 + fraction * this.size;
  }

  private cellX(col: number): number {
    return this.boardLeft + (col + 0.5) * this.cell;
  }

  /** Row 0 is the bottom of the grid, so the drawing order runs the other way. */
  private cellY(row: number): number {
    return this.boardTop + (ROWS - 1 - row + 0.5) * this.cell;
  }

  protected draw(): void {
    this.drawGhost();
    this.drawGrid();
    this.drawDiscs();
    this.drawFalling();
    this.drawWin();
    this.drawCaption();
  }

  /** Where the next disc would land, shown before it is committed to. */
  private drawGhost(): void {
    if (this.hover === null || this.phase !== 'thinking') return;

    // In auto mode the ghost previews the tap, and a tap deals a fresh board - so it
    // answers for the grid that click will produce, on which every column is open.
    if (this.mode === 'auto') {
      this.disc(this.cellX(this.hover), this.fy(LANE_Y), RED_INK, 0.4);
      return;
    }
    if (this.turn !== RED) return;
    if (heightOf(this.board, this.hover) >= ROWS) return;
    this.disc(this.cellX(this.hover), this.fy(LANE_Y), RED_INK, 0.4);
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const w = COLS * this.cell;
    const h = ROWS * this.cell;
    const pad = this.cell * 0.1;

    ctx.fillStyle = `rgba(${FRAME},0.28)`;
    roundedPath(
      ctx,
      this.boardLeft - pad,
      this.boardTop - pad,
      w + pad * 2,
      h + pad * 2,
      this.cell * 0.28,
    );
    ctx.fill();

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        this.disc(this.cellX(c), this.cellY(r), HOLE, 0.55);
      }
    }
  }

  private drawDiscs(): void {
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const v = this.board[idx(c, r)]!;
        if (v === 0) continue;
        this.disc(this.cellX(c), this.cellY(r), v === RED ? RED_INK : YELLOW_INK, 0.92);
      }
    }
  }

  private drawFalling(): void {
    const disc = this.falling;
    if (!disc) return;
    const ink = disc.player === RED ? RED_INK : YELLOW_INK;
    this.disc(this.cellX(disc.col), disc.y, ink, 0.92);
  }

  /**
   * The winning four, ringed rather than recoloured.
   *
   * A ring says "these ones" without depending on telling red from yellow, which is the
   * one thing on this widget somebody might not be able to do.
   */
  private drawWin(): void {
    if (!this.winLine) return;
    const ctx = this.ctx;
    const pulse = 0.55 + 0.45 * Math.sin(this.overTimer * 6);

    ctx.strokeStyle = `rgba(${INK},${pulse})`;
    ctx.lineWidth = Math.max(1.5, this.size * 0.009);
    for (const cell of this.winLine) {
      const c = Math.floor(cell / ROWS);
      const r = cell % ROWS;
      ctx.beginPath();
      ctx.arc(this.cellX(c), this.cellY(r), DISC * this.size + this.size * 0.008, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * The one line of words on the widget.
   *
   * Like Wordle's, it is mostly there to say what a tap will do *before* you make it,
   * since dealing a fresh board over the one on screen is the only surprising thing this
   * widget does.
   */
  private caption(): string {
    if (this.phase === 'over') {
      if (this.result === 'draw') return 'drawn';
      if (this.mode === 'player') return this.result === 'red' ? 'you win' : 'you lose';
      return this.result === 'red' ? 'red wins' : 'yellow wins';
    }
    if (this.mode === 'auto') return 'tap a column to play';
    return this.turn === RED ? 'your move' : 'thinking';
  }

  private drawCaption(): void {
    const ctx = this.ctx;
    const won = this.phase === 'over' && this.mode === 'player' && this.result === 'red';

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = won ? `rgba(${INK},0.95)` : `rgba(${FACE},0.85)`;
    ctx.font = `${won ? '700 ' : ''}${Math.round(this.size * 0.038)}px system-ui, sans-serif`;
    ctx.fillText(this.caption(), this.fx(0.5), this.fy(CAPTION_Y));
    ctx.restore();
  }

  private disc(x: number, y: number, colour: string, alpha: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(${colour},${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, DISC * this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** `roundRect` is still uneven across the canvas implementations this runs on. */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}
