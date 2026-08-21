import { CanvasWidget } from './types';

/**
 * Wordle, on the pointer alone.
 *
 * Every other widget here could at least be argued about; this one had exactly one way to
 * be built. The window is `focusable: false`, so the only keys that ever reach a widget
 * come from a global accelerator, and `main/keyboard.ts` is explicit that those are arrows
 * and never letters - a widget that grabbed twenty-six letters off the desktop would eat
 * ordinary typing, which is the one thing this product must never do. So the keyboard is
 * drawn on the canvas and clicked, and that is not a fallback: it is the whole scheme.
 *
 * **A hand arriving deals a fresh puzzle**, and that is the part worth explaining, because
 * every other game here hands over the board it was already playing. Wordle cannot. Simon
 * has the same problem from the other end - `CONTRIBUTING.md` records that a memory game
 * cannot demo itself without spending the round it is demoing - and a deduction game is
 * worse off still: an autopilot that has narrowed the answer to two words has not left you
 * a game, it has left you its working. Inheriting that is marking somebody's homework, not
 * playing Wordle. Simon's answer was to sit still and wait, which it had to earn and which
 * a second widget should not spend again; this one keeps playing and deals you a clean
 * grid instead. The caption says so before you touch it, so the reset is something you
 * asked for rather than something that happened.
 *
 * The tap that hands over still lands. The keyboard does not move between puzzles, so the
 * letter under the cursor is the letter you meant whichever grid is behind it - swallowing
 * that first press would make the handover feel like a dropped input.
 *
 * **Guesses are not checked against a dictionary.** A list big enough to accept the words
 * people actually try is far bigger than this app's whole source, and a small one is worse
 * than none: being told CRANE is not a word is the single most annoying thing a Wordle can
 * do. Anything five letters long is a guess. The autopilot draws from `WORDS`, so what you
 * watch it play is always real, and `WORDS` is where the answer comes from too.
 *
 * **Nothing to escalate.** Six guesses is a hard ceiling, so unlike Tetris this reaches an
 * ending whatever happens and there is no difficulty ramp holding the run together. The
 * one way out is a board somebody walked away from mid-puzzle: games are exempt from the
 * cycle clock, so nothing else would ever move it on. After `RESUME_SECONDS` untouched the
 * autopilot takes the board back - clues and all, which is exactly what it needs - and
 * plays it out.
 *
 * Silent, and not for want of a voice: the marks are colour, and a sound could only say
 * again what the tiles already said. Sound that carries nothing is sound you switch off.
 */

const LETTERS = 5;
const TRIES = 6;

/**
 * The answer pool, and the autopilot's candidate set - the same list doing both jobs.
 *
 * Common words only. A Wordle whose answer is a word you have to be told is a word is a
 * puzzle nobody can lose fairly, and this one is on screen for a minute at a time.
 */
export const WORDS: string[] = `
  ABOUT ABOVE ACTOR ADMIT ADOPT AFTER AGAIN AGENT AGREE AHEAD ALARM ALBUM ALERT ALIKE
  ALIVE ALLOW ALONE ALONG ALTER AMONG ANGER ANGLE ANGRY ANKLE APART APPLE APPLY ARENA
  ARGUE ARISE ARRAY ASIDE ASSET AUDIO AVOID AWARD AWARE BADGE BAKER BASIC BEACH BEGAN
  BEGIN BEING BELOW BENCH BIRTH BLACK BLADE BLAME BLANK BLAST BLEND BLIND BLOCK BLOOD
  BOARD BOAST BONUS BOOST BOUND BRAIN BRAND BRAVE BREAD BREAK BRIEF BRING BROAD BROKE
  BROWN BRUSH BUILD BUILT BUNCH BURST CABIN CABLE CANDY CARGO CARRY CARVE CATCH CAUSE
  CHAIN CHAIR CHALK CHARM CHART CHASE CHEAP CHECK CHEST CHIEF CHILD CHOIR CHOSE CIVIL
  CLAIM CLASS CLEAN CLEAR CLERK CLICK CLIFF CLIMB CLOCK CLOSE CLOTH CLOUD COACH COAST
  COUNT COURT COVER CRACK CRAFT CRANE CRASH CRAZY CREAM CRIME CROSS CROWD CROWN CRUSH
  CURVE CYCLE DAILY DANCE DEALT DEATH DEBUT DELAY DEPTH DIRTY DOUBT DOZEN DRAFT DRAIN
  DRAMA DRANK DREAM DRESS DRIED DRIFT DRINK DRIVE DROVE DYING EAGER EARLY EARTH EIGHT
  ELBOW ELDER EMPTY ENEMY ENJOY ENTER ENTRY EQUAL ERROR EVENT EVERY EXACT EXIST EXTRA
  FAITH FALSE FANCY FAULT FEAST FENCE FEVER FIBER FIELD FIFTH FIFTY FIGHT FINAL FIRST
  FLAME FLASH FLEET FLESH FLOAT FLOOD FLOOR FLOUR FLUID FOCUS FORCE FORGE FORTH FORTY
  FORUM FOUND FRAME FRANK FRAUD FRESH FRONT FROST FRUIT FULLY FUNNY GIANT GLASS GLOBE
  GLORY GRACE GRADE GRAIN GRAND GRANT GRAPE GRAPH GRASP GRASS GRAVE GREAT GREEN GREET
  GRIEF GRILL GROSS GROUP GROWN GUARD GUESS GUEST GUIDE GUILT HABIT HAPPY HARSH HEART
  HEAVY HENCE HOBBY HONEY HONOR HORSE HOTEL HOUSE HUMAN HUMOR HURRY IDEAL IMAGE IMPLY
  INDEX INNER INPUT ISSUE IVORY JOINT JUDGE JUICE KNIFE KNOCK KNOWN LABEL LARGE LASER
  LATER LAUGH LAYER LEARN LEASE LEAST LEAVE LEGAL LEMON LEVEL LIGHT LIMIT LINEN LIVER
  LOCAL LODGE LOGIC LOOSE LOWER LOYAL LUCKY LUNCH LYING MAGIC MAJOR MAKER MARCH MATCH
  MAYBE MAYOR MEDAL MEDIA MERCY MERGE MERIT METAL METER MIDST MIGHT MINOR MINUS MIXED
  MODEL MONEY MONTH MORAL MOTOR MOUNT MOUSE MOUTH MOVIE MUSIC NAKED NASTY NAVAL NERVE
  NEVER NEWLY NIGHT NOBLE NOISE NORTH NOTED NOVEL NURSE OCCUR OCEAN OFFER OFTEN OLIVE
  ONION ORDER OTHER OUGHT OUNCE OUTER OWNER PAINT PANEL PANIC PAPER PARTY PATCH PAUSE
  PEACE PEARL PEDAL PENNY PHASE PHONE PHOTO PIANO PIECE PILOT PITCH PLACE PLAIN PLANE
  PLANT PLATE POINT POUND POWER PRESS PRICE PRIDE PRIME PRINT PRIOR PRIZE PROOF PROUD
  PROVE PUPIL PURSE QUEEN QUERY QUEST QUICK QUIET QUITE QUOTE RADAR RADIO RAISE RANGE
  RAPID RATIO REACH READY REALM REBEL REFER RELAX REPLY RHYME RIDGE RIFLE RIGHT RIGID
  RIVAL RIVER ROAST ROBOT ROCKY ROMAN ROUGH ROUND ROUTE ROYAL RUGBY RURAL SADLY SAINT
  SALAD SANDY SAUCE SCALE SCARF SCENE SCOPE SCORE SCOUT SCRAP SENSE SERVE SEVEN SHADE
  SHAFT SHAKE SHALL SHAME SHAPE SHARE SHARP SHEEP SHEET SHELF SHELL SHIFT SHINE SHIRT
  SHOCK SHOOT SHORE SHORT SHOUT SHOWN SIGHT SILLY SINCE SIXTH SIXTY SKILL SKIRT SLEEP
  SLICE SLIDE SLOPE SMALL SMART SMELL SMILE SMOKE SNAKE SOLAR SOLID SOLVE SORRY SOUND
  SOUTH SPACE SPARE SPARK SPEAK SPEED SPELL SPEND SPICE SPINE SPLIT SPOKE SPORT SPRAY
  STAFF STAGE STAIR STAKE STAMP STAND STARE START STATE STEAM STEEL STEEP STEER STICK
  STILL STOCK STONE STOOD STORE STORM STORY STOVE STRAP STRAW STRIP STUCK STUDY STUFF
  STYLE SUGAR SUITE SUPER SWEEP SWEET SWIFT SWING SWORD TABLE TASTE TEACH TEETH TEMPO
  TENSE THANK THEFT THEIR THEME THERE THESE THICK THIEF THING THINK THIRD THOSE THREE
  THREW THROW THUMB TIGER TIGHT TIMER TIRED TITLE TOAST TODAY TOKEN TOOTH TOPIC TOTAL
  TOUCH TOUGH TOWER TRACE TRACK TRADE TRAIL TRAIN TRASH TREAT TREND TRIAL TRIBE TRICK
  TRIED TRUCK TRULY TRUNK TRUST TRUTH TWICE TWIST ULTRA UNCLE UNDER UNION UNITE UNITY
  UNTIL UPPER UPSET URBAN USAGE USUAL VAGUE VALID VALUE VAPOR VAULT VENUE VERSE VIDEO
  VIRUS VISIT VITAL VOCAL VOICE WAGON WASTE WATCH WATER WHEAT WHEEL WHERE WHICH WHILE
  WHITE WHOLE WHOSE WIDOW WIDTH WOMAN WOMEN WORLD WORRY WORSE WORST WORTH WOULD WOUND
  WRIST WRITE WRONG WROTE YIELD YOUNG YOUTH
`
  .trim()
  .split(/\s+/);

/** The three rows of a keyboard everyone already knows the shape of. */
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const ENTER = 'ENTER';
const DELETE = 'DEL';

/** Layout, as fractions of the box's square. The grid on top, the keyboard under it. */
const TILE = 0.078;
const TILE_GAP = 0.013;
const BOARD_Y = 0.055;
const CAPTION_Y = 0.645;
const KEY_W = 0.085;
const KEY_H = 0.072;
const KEY_GAP = 0.01;
/** Enter and delete carry words rather than a letter, so they get the room to say them. */
const WIDE_KEY = KEY_W * 1.7;
const KEY_Y = 0.685;

/**
 * Seconds per letter as the autopilot types, and the beat it leaves before committing.
 *
 * Typed out rather than filled in at once, because the guess is the interesting part and a
 * word that simply appears is a word nobody read. The pause before submitting is the same
 * idea from the other end - it is the moment you would take to check.
 */
const AUTO_LETTER = 0.11;
const AUTO_SUBMIT = 0.34;
/** How long the autopilot appears to think between a mark and its next guess. */
const AUTO_THINK = 0.55;

/** Seconds a tile takes to turn over. Five of them is the length of a row's reveal. */
const REVEAL_STEP = 0.2;
/** How long the result is held before handing over, so the run has an ending. */
const OVER_PAUSE = 2.4;
/** How long the "five letters" nudge stays up, and how fast the row shivers under it. */
const NUDGE_SECONDS = 0.45;
const NUDGE_RATE = 34;

/**
 * How long a player's board waits for them before the autopilot finishes it.
 *
 * Long enough to actually think - a Wordle you solve in four seconds was not worth
 * solving - and short enough that a grid somebody wandered off from still reaches an
 * ending. It has to reach one: a game holds the screen until it calls `finish()`, and a
 * half-typed row will not end by itself the way a falling stack does.
 */
const RESUME_SECONDS = 20;

/** How many of the best-scoring words the autopilot picks its guess from at random. */
const TOP_PICKS = 8;

const HIT = '134,239,172';
const NEAR = '253,224,71';
const MISS = '71,85,105';
const FACE = '148,163,184';
const INK = '226,232,240';

export type Mark = 'hit' | 'near' | 'miss';
type Phase = 'typing' | 'revealing' | 'over';
/** Whichever hand is on it, and it opens on its own. */
type Mode = 'auto' | 'player';

interface Key {
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Mark a guess against an answer, the way Wordle does.
 *
 * Two passes, and it has to be two: the exact matches claim their letters before anything
 * is called present-but-misplaced, or a guess of SPEED against ERASE paints both E's
 * yellow when the answer only has one left to give. Getting this wrong is the classic
 * Wordle bug and it is invisible until the day it costs somebody a run.
 */
export function markGuess(guess: string, answer: string): Mark[] {
  const marks: Mark[] = new Array<Mark>(LETTERS).fill('miss');
  const spare: Array<string | null> = answer.split('');

  for (let i = 0; i < LETTERS; i++) {
    if (guess[i] !== answer[i]) continue;
    marks[i] = 'hit';
    spare[i] = null;
  }
  for (let i = 0; i < LETTERS; i++) {
    if (marks[i] === 'hit') continue;
    const j = spare.indexOf(guess[i]!);
    if (j < 0) continue;
    marks[i] = 'near';
    spare[j] = null;
  }
  return marks;
}

export class Wordle extends CanvasWidget {
  private answer = '';
  /** The rows already committed, and what each one came back as. */
  private guesses: string[] = [];
  private marks: Mark[][] = [];
  /** The row being typed, however far it has got. */
  private current = '';
  /**
   * Words still consistent with every mark on the board.
   *
   * Kept up to date for a player's guesses as well as the autopilot's, which is the whole
   * reason it is a field rather than something worked out when needed: an abandoned board
   * is handed back mid-puzzle, and the autopilot has to be able to carry on from what is
   * already on screen.
   */
  private candidates: string[] = [];
  private keyMarks: Record<string, Mark> = {};
  private keys: Key[] = [];
  private phase: Phase = 'typing';
  private mode: Mode = 'auto';
  private result: 'win' | 'loss' | null = null;
  /** The word the autopilot has decided on and is part-way through typing. */
  private plan: string | null = null;
  private autoTimer = 0;
  private revealT = 0;
  private overTimer = 0;
  private idle = 0;
  private nudge = 0;
  /** A one-off complaint - only ever "five letters", and only until it times out. */
  private note = '';
  private hover: string | null = null;
  private tile = 0;
  private pitch = 0;
  private boardX = 0;
  private boardY = 0;

  protected init(): void {
    this.tile = TILE * this.size;
    this.pitch = (TILE + TILE_GAP) * this.size;
    this.boardX = this.fx(0.5) - (LETTERS * this.tile + (LETTERS - 1) * TILE_GAP * this.size) / 2;
    this.boardY = this.fy(BOARD_Y);
    this.layOutKeys();
    this.mode = 'auto';
    this.result = null;
    this.hover = null;
    this.deal();
  }

  /** A fresh word and an empty grid. The keyboard is built once and outlives this. */
  private deal(): void {
    this.answer = WORDS[Math.floor(Math.random() * WORDS.length)]!;
    this.guesses = [];
    this.marks = [];
    this.current = '';
    this.candidates = [...WORDS];
    this.keyMarks = {};
    this.phase = 'typing';
    this.result = null;
    this.plan = null;
    this.autoTimer = AUTO_THINK;
    this.revealT = 0;
    this.overTimer = 0;
    this.idle = 0;
    this.nudge = 0;
    this.note = '';
  }

  /**
   * The keyboard, in canvas coordinates, worked out once.
   *
   * Every row is centred on its own width rather than left-aligned to a common margin,
   * which is what makes the middle row sit inside the top one the way the real thing does.
   */
  private layOutKeys(): void {
    this.keys = [];
    KEY_ROWS.forEach((row, r) => {
      const values = r === KEY_ROWS.length - 1 ? [ENTER, ...row, DELETE] : [...row];
      const widths = values.map((v) => (v.length > 1 ? WIDE_KEY : KEY_W));
      const span = widths.reduce((a, b) => a + b, 0) + KEY_GAP * (values.length - 1);
      const y = this.fy(KEY_Y + r * (KEY_H + KEY_GAP));

      let at = (1 - span) / 2;
      values.forEach((value, i) => {
        const w = widths[i]!;
        this.keys.push({ value, x: this.fx(at), y, w: w * this.size, h: KEY_H * this.size });
        at += w + KEY_GAP;
      });
    });
  }

  protected update(dt: number): void {
    if (this.nudge > 0) this.nudge = Math.max(0, this.nudge - dt);
    if (this.nudge === 0) this.note = '';

    if (this.phase === 'over') {
      this.overTimer += dt;
      if (this.overTimer >= OVER_PAUSE) this.finish();
      return;
    }

    if (this.phase === 'revealing') {
      this.revealT += dt;
      if (this.revealT >= REVEAL_STEP * LETTERS) this.settle();
      return;
    }

    if (this.mode === 'player') {
      this.idle += dt;
      if (this.idle >= RESUME_SECONDS) this.takeBack();
      return;
    }
    this.autoType(dt);
  }

  /**
   * The autopilot picking a word up again after a player put it down.
   *
   * The board stays exactly as it is - the marks on it are the constraints, and throwing
   * them away to start over would waste the guesses the player already spent.
   */
  private takeBack(): void {
    this.mode = 'auto';
    this.current = '';
    this.plan = null;
    this.autoTimer = AUTO_THINK;
  }

  private autoType(dt: number): void {
    this.autoTimer -= dt;
    if (this.autoTimer > 0) return;

    if (this.plan === null) {
      this.plan = this.choose();
      this.autoTimer = AUTO_LETTER;
      return;
    }
    if (this.current.length < LETTERS) {
      this.current += this.plan[this.current.length]!;
      this.autoTimer = this.current.length === LETTERS ? AUTO_SUBMIT : AUTO_LETTER;
      return;
    }
    this.plan = null;
    this.submit();
  }

  /**
   * The autopilot's next guess: the most informative word that could still be the answer.
   *
   * Scored by how common each of its letters is in that position among the words still
   * standing, counting a repeated letter once - a guess that spends two of its five slots
   * on the same letter has asked four questions instead of five.
   *
   * It only ever guesses words that could still be right, which is Wordle's hard mode and
   * a deliberate handicap. A solver allowed to spend a guess purely on information wins
   * essentially always, and a game you never see lost is a game with nothing at stake; this
   * one gets caught out by a rack of near-identical words the way a person does. Picking at
   * random from the best few rather than taking the top one is the other half of that: it
   * keeps the opening different every run, and it makes the coin-flip between two survivors
   * an actual coin flip.
   */
  private choose(): string {
    const pool = this.candidates.length > 0 ? this.candidates : WORDS;
    const seen: number[][] = Array.from({ length: LETTERS }, () => new Array<number>(26).fill(0));
    for (const word of pool) {
      for (let i = 0; i < LETTERS; i++) seen[i]![word.charCodeAt(i) - 65]!++;
    }

    const ranked = pool
      .map((word) => {
        let score = 0;
        for (let i = 0; i < LETTERS; i++) {
          if (word.indexOf(word[i]!) < i) continue;
          score += seen[i]![word.charCodeAt(i) - 65]!;
        }
        return { word, score };
      })
      .sort((a, b) => b.score - a.score);

    const top = ranked.slice(0, Math.min(TOP_PICKS, ranked.length));
    return top[Math.floor(Math.random() * top.length)]!.word;
  }

  private submit(): void {
    if (this.current.length < LETTERS) {
      // The row shivers and says why. Nothing happening at all would read as a dead button.
      this.nudge = NUDGE_SECONDS;
      this.note = 'five letters';
      return;
    }

    const guess = this.current;
    const marks = markGuess(guess, this.answer);
    this.guesses.push(guess);
    this.marks.push(marks);
    for (let i = 0; i < LETTERS; i++) this.raiseKey(guess[i]!, marks[i]!);
    // Narrowed for whoever guessed, player or not - see `candidates`.
    this.candidates = this.candidates.filter((word) => sameMarks(markGuess(guess, word), marks));

    this.current = '';
    this.note = '';
    this.nudge = 0;
    this.phase = 'revealing';
    this.revealT = 0;
  }

  /** The row has finished turning over: won, lost, or on to the next one. */
  private settle(): void {
    const marks = this.marks[this.marks.length - 1];
    if (marks && marks.every((m) => m === 'hit')) {
      this.result = 'win';
      this.phase = 'over';
      this.overTimer = 0;
      return;
    }
    if (this.guesses.length >= TRIES) {
      this.result = 'loss';
      this.phase = 'over';
      this.overTimer = 0;
      return;
    }
    this.phase = 'typing';
    this.autoTimer = AUTO_THINK;
  }

  /**
   * A letter's key takes the best mark it has ever earned and never gives it back.
   *
   * Green outranks yellow outranks grey, because a later guess that puts a known letter in
   * the wrong slot would otherwise demote a key you had already solved.
   */
  private raiseKey(letter: string, mark: Mark): void {
    const rank: Record<Mark, number> = { miss: 0, near: 1, hit: 2 };
    const held = this.keyMarks[letter];
    if (held !== undefined && rank[held] >= rank[mark]) return;
    this.keyMarks[letter] = mark;
  }

  private keyAt(x: number, y: number): Key | null {
    for (const key of this.keys) {
      if (x < key.x || x > key.x + key.w) continue;
      if (y < key.y || y > key.y + key.h) continue;
      return key;
    }
    return null;
  }

  override onPointerDown(x: number, y: number): void {
    // The result is the ending; a press during it is somebody reaching for the next thing.
    if (this.phase === 'over') return;

    const key = this.keyAt(x, y);
    if (this.mode === 'auto') {
      // See the header: a puzzle solved in front of you is not a puzzle you can be handed.
      this.deal();
      this.mode = 'player';
    }
    this.idle = 0;
    if (key) this.press(key.value);
  }

  private press(value: string): void {
    if (this.phase !== 'typing') return;
    if (value === ENTER) {
      this.submit();
      return;
    }
    if (value === DELETE) {
      this.current = this.current.slice(0, -1);
      this.nudge = 0;
      return;
    }
    if (this.current.length >= LETTERS) return;
    this.current += value;
    this.nudge = 0;
  }

  /**
   * Hover, which is doing more work here than it looks.
   *
   * These keys are twenty pixels across. Lighting the one under the cursor is what turns
   * that from aiming into pointing, and it costs a hit test that already exists.
   */
  override onPointerMove(x: number, y: number): void {
    this.hover = this.keyAt(x, y)?.value ?? null;
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

  protected draw(): void {
    this.drawBoard();
    this.drawCaption();
    this.drawKeys();
  }

  private drawBoard(): void {
    const revealing = this.phase === 'revealing' ? this.guesses.length - 1 : -1;
    // Only the row being typed shivers, and only while the nudge lasts.
    const shake =
      this.nudge > 0 ? Math.sin(this.nudge * NUDGE_RATE) * this.size * 0.014 * this.nudge : 0;

    for (let r = 0; r < TRIES; r++) {
      const guess = this.guesses[r];
      const typing = guess === undefined && r === this.guesses.length;
      for (let i = 0; i < LETTERS; i++) {
        const letter = guess?.[i] ?? (typing ? (this.current[i] ?? '') : '');
        // A tile turns over on its own beat, a fifth of a second after the one before it.
        const turn = r === revealing ? clamp(this.revealT / REVEAL_STEP - i, 0, 1) : guess ? 1 : 0;
        this.drawTile(
          this.boardX + i * this.pitch + (typing ? shake : 0),
          this.boardY + r * this.pitch,
          letter,
          guess ? this.marks[r]![i]! : null,
          turn,
        );
      }
    }
  }

  /**
   * One tile, part-way through turning over.
   *
   * Squashed vertically to nothing and back rather than actually rotated, which is what a
   * flip looks like from the front anyway, and the mark is swapped in at the halfway point
   * where the tile is edge-on and there is nothing to see.
   */
  private drawTile(x: number, y: number, letter: string, mark: Mark | null, turn: number): void {
    const ctx = this.ctx;
    const shown = turn >= 0.5 ? mark : null;
    // Never exactly zero: a zero scale is a degenerate transform, and the seam it leaves
    // reads as the tile blinking out rather than turning.
    const squash = mark === null ? 1 : Math.max(0.04, Math.abs(Math.cos(Math.PI * turn)));
    const cy = y + this.tile / 2;

    ctx.save();
    ctx.translate(0, cy);
    ctx.scale(1, squash);
    ctx.translate(0, -cy);

    if (shown === null) {
      ctx.fillStyle = 'rgba(15,23,42,0.3)';
      ctx.fillRect(x, y, this.tile, this.tile);
      // An empty tile is outlined and a filled one is not, so a row you are part-way
      // through typing shows how much of it is left without a word about it.
      ctx.strokeStyle = `rgba(${FACE},${letter ? 0.6 : 0.28})`;
      ctx.lineWidth = Math.max(1, this.size * 0.005);
      ctx.strokeRect(x, y, this.tile, this.tile);
    } else {
      ctx.fillStyle = `rgba(${colourOf(shown)},${shown === 'miss' ? 0.75 : 0.9})`;
      ctx.fillRect(x, y, this.tile, this.tile);
    }

    if (letter) {
      ctx.fillStyle = shown === null || shown === 'miss' ? `rgba(${INK},0.95)` : 'rgba(15,23,42,0.9)';
      ctx.font = `700 ${Math.round(this.size * 0.048)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, x + this.tile / 2, cy);
    }
    ctx.restore();
  }

  /**
   * The one line of words on the widget.
   *
   * It is mostly there to say what a tap will do *before* you make it, since dealing a
   * fresh puzzle over the one on screen is the only surprising thing this widget does.
   */
  private caption(): string {
    if (this.phase === 'over') {
      return this.result === 'win' ? `solved in ${this.guesses.length}` : this.answer;
    }
    if (this.note) return this.note;
    if (this.mode === 'auto') return 'tap for a fresh puzzle';
    return `${TRIES - this.guesses.length} left`;
  }

  private drawCaption(): void {
    const ctx = this.ctx;
    const lost = this.phase === 'over' && this.result === 'loss';

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The answer is the one thing here worth reading twice, so a lost run says it louder
    // than the hint it replaces - and in the colour it would have been.
    ctx.fillStyle = lost ? `rgba(${NEAR},0.95)` : `rgba(${FACE},0.85)`;
    ctx.font = `${lost ? '700 ' : ''}${Math.round(this.size * (lost ? 0.05 : 0.038))}px system-ui, sans-serif`;
    ctx.fillText(this.caption(), this.fx(0.5), this.fy(CAPTION_Y));
    ctx.restore();
  }

  private drawKeys(): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const key of this.keys) {
      const mark = this.keyMarks[key.value];
      const wide = key.value.length > 1;
      const lit = this.hover === key.value;

      ctx.fillStyle = mark
        ? `rgba(${colourOf(mark)},${mark === 'miss' ? 0.55 : 0.85})`
        : `rgba(${FACE},${lit ? 0.42 : 0.22})`;
      ctx.fillRect(key.x, key.y, key.w, key.h);
      if (lit) {
        ctx.strokeStyle = `rgba(${INK},0.7)`;
        ctx.lineWidth = Math.max(1, this.size * 0.005);
        ctx.strokeRect(key.x, key.y, key.w, key.h);
      }

      ctx.fillStyle = mark === 'hit' || mark === 'near' ? 'rgba(15,23,42,0.9)' : `rgba(${INK},0.9)`;
      ctx.font = `600 ${Math.round(this.size * (wide ? 0.03 : 0.038))}px system-ui, sans-serif`;
      ctx.fillText(key.value, key.x + key.w / 2, key.y + key.h / 2);
    }
  }
}

function colourOf(mark: Mark): string {
  if (mark === 'hit') return HIT;
  if (mark === 'near') return NEAR;
  return MISS;
}

function sameMarks(a: Mark[], b: Mark[]): boolean {
  for (let i = 0; i < LETTERS; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
