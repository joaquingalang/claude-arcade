/** The keys the app takes from the rest of the desktop whenever a game asks for them. */
export type ArrowKey = 'Up' | 'Down' | 'Left' | 'Right';
/**
 * The two it takes only while somebody is demonstrably mid-run.
 *
 * Named by what they do rather than by which key sends them: a widget has no business
 * knowing that "put this piece by for later" is spelt C, and main has no business asking
 * it to. See `main/keyboard.ts` for why these two are held on a much shorter lead than
 * the arrows are.
 */
export type ActionKey = 'Drop' | 'Hold';
export type GameKey = ArrowKey | ActionKey;

export interface WidgetOptions {
  /** CSS pixel width of the canvas. Rendering must stay inside this box. */
  width: number;
  /** CSS pixel height of the canvas. Rendering must stay inside this box. */
  height: number;
  /**
   * Whether the arrow keys will actually reach this widget.
   *
   * Only two widgets ask for keys and the user can switch the grab off entirely, so a
   * widget that draws its own controls has to be told rather than assume. Defaults to
   * false: a widget built against this must be honest in the harness and the tests, where
   * there is no main process to ask.
   */
  keyboard?: boolean;
  /**
   * Called once when a self-paced widget's run is over.
   *
   * The fidget toys never call it - they have no end, so the clock decides when they hand
   * over. The games do, and that is the whole difference: a game interrupted mid-play by
   * a timer is worse than no game.
   */
  onDone?: () => void;
  /**
   * Called when the widget starts or stops asking the cycle clock to wait for a player.
   *
   * For a toy a person can be *midway through* - a half-solved puzzle is worth finishing,
   * and being swapped out three moves from the end is the same insult as losing a game at
   * 4-3. It is not a way for a toy to appoint itself a game: a widget nobody is touching
   * must never hold, because the clock is the only thing that moves an endless toy along.
   * Main caps how long a hold is honoured regardless.
   */
  onHold?: (holding: boolean) => void;
}

/**
 * The widget contract from the product vision.
 *
 * Implementations own their own requestAnimationFrame loop. `pause()` must actually
 * stop that loop - a desk toy burning CPU while invisible defeats the purpose.
 */
export interface Widget {
  start(ctx: CanvasRenderingContext2D, opts: WidgetOptions): void;
  stop(): void;
  pause(): void;
  resume(): void;
}

export type WidgetFactory = () => Widget;

/**
 * Shared rAF plumbing. Every widget needs exactly this loop, and getting pause/resume
 * subtly wrong in three places is a needless risk.
 */
export abstract class CanvasWidget implements Widget {
  protected ctx!: CanvasRenderingContext2D;
  protected width = 0;
  protected height = 0;
  /**
   * The largest square that fits in the box.
   *
   * Most toys are square and lay themselves out against this. Only a widget that
   * genuinely needs the extra room - the cradle, whose swing is far wider than it is
   * tall - should reach for `width`/`height` directly.
   */
  protected size = 0;
  /** Whether `onKey` will ever be called - see `WidgetOptions.keyboard`. */
  protected keyboard = false;
  private raf: number | null = null;
  private lastTime = 0;
  private done: (() => void) | undefined;
  private holdCycle: ((holding: boolean) => void) | undefined;
  /** Latched, so a game that ends on the same frame it draws can't report twice. */
  private finished = false;
  /** Latched the other way: only changes of mind are worth an IPC message. */
  private holding = false;

  start(ctx: CanvasRenderingContext2D, opts: WidgetOptions): void {
    this.ctx = ctx;
    this.width = opts.width;
    this.height = opts.height;
    this.size = Math.min(opts.width, opts.height);
    this.keyboard = opts.keyboard ?? false;
    this.done = opts.onDone;
    this.holdCycle = opts.onHold;
    this.finished = false;
    this.holding = false;
    this.init();
    this.resume();
  }

  stop(): void {
    this.pause();
    // Let the clock go before the callbacks are dropped. A widget torn down mid-hold must
    // not leave the cycle waiting on a board that no longer exists.
    this.setHold(false);
    // Drop the callback before teardown: whoever is tearing this widget down has already
    // moved on, and a late report would rotate the toy that just replaced it.
    this.done = undefined;
    this.holdCycle = undefined;
    this.teardown();
  }

  /**
   * Ask the cycle clock to wait, or release it.
   *
   * Only for the stretch a player is actually midway through something; see `onHold` for
   * why a toy must not hold while nobody is touching it.
   */
  protected setHold(holding: boolean): void {
    if (this.holding === holding) return;
    this.holding = holding;
    this.holdCycle?.(holding);
  }

  /**
   * Report that this widget's run is over and it is ready to hand over.
   *
   * Idempotent by design - subclasses call it from inside `update()`, where the frame
   * that ends the game may well run again before the swap lands.
   */
  protected finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.done?.();
  }

  pause(): void {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  resume(): void {
    if (this.raf !== null) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      // Clamp dt: after a long pause an unclamped delta would teleport everything.
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      this.update(dt);
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  protected abstract init(): void;
  protected abstract update(dt: number): void;
  protected abstract draw(): void;
  protected teardown(): void {}

  /** Pointer events, in canvas coordinates. */
  onPointerDown(_x: number, _y: number): void {}
  onPointerMove(_x: number, _y: number): void {}
  onPointerUp(_x: number, _y: number): void {}

  /**
   * A game key, forwarded from the main process.
   *
   * The window is `focusable: false`, so it never receives a keydown of its own. These
   * arrive from a global accelerator that main registers only while a widget that wants
   * keys is on screen - see `main/keyboard.ts` for what that costs.
   *
   * A widget is sent every key main is holding, not only the ones it uses, so one that
   * has no use for an `ActionKey` must ignore it outright rather than treat it as a hand
   * arriving on the keyboard.
   */
  onKey(_key: GameKey): void {}
}
