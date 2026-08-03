/** The only keys the app ever takes from the rest of the desktop. */
export type ArrowKey = 'Up' | 'Down' | 'Left' | 'Right';

export interface WidgetOptions {
  /** CSS pixel width of the canvas. Rendering must stay inside this box. */
  width: number;
  /** CSS pixel height of the canvas. Rendering must stay inside this box. */
  height: number;
  /**
   * Called once when a self-paced widget's run is over.
   *
   * The fidget toys never call it - they have no end, so the clock decides when they hand
   * over. The games do, and that is the whole difference: a game interrupted mid-play by
   * a timer is worse than no game.
   */
  onDone?: () => void;
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
  private raf: number | null = null;
  private lastTime = 0;
  private done: (() => void) | undefined;
  /** Latched, so a game that ends on the same frame it draws can't report twice. */
  private finished = false;

  start(ctx: CanvasRenderingContext2D, opts: WidgetOptions): void {
    this.ctx = ctx;
    this.width = opts.width;
    this.height = opts.height;
    this.size = Math.min(opts.width, opts.height);
    this.done = opts.onDone;
    this.finished = false;
    this.init();
    this.resume();
  }

  stop(): void {
    this.pause();
    // Drop the callback before teardown: whoever is tearing this widget down has already
    // moved on, and a late report would rotate the toy that just replaced it.
    this.done = undefined;
    this.teardown();
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
   * A direction key, forwarded from the main process.
   *
   * The window is `focusable: false`, so it never receives a keydown of its own. These
   * arrive from a global accelerator that main registers only while a widget that wants
   * keys is on screen - see `main/keyboard.ts` for what that costs.
   */
  onKey(_key: ArrowKey): void {}
}
