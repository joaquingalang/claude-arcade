import { globalShortcut } from 'electron';

import type { ActionKey, ArrowKey, GameKey } from './widget-ids';

const ARROWS: ArrowKey[] = ['Up', 'Down', 'Left', 'Right'];

/**
 * The action keys, and the accelerator each answers to.
 *
 * Named by what they do rather than by which key sends them, so the renderer never has to
 * know that "put the piece by for later" is spelt C - and so changing which key that is
 * stays a one-line edit here.
 */
const ACTIONS: Array<{ accelerator: string; key: ActionKey }> = [
  { accelerator: 'Space', key: 'Drop' },
  { accelerator: 'C', key: 'Hold' },
];

/**
 * How long a press keeps the action keys, once one has armed them.
 *
 * Long enough that the pauses inside ordinary play - lining a piece up, watching a row
 * come down - never drop the grab mid-game, and short enough that turning back to the
 * terminal hands the space bar over before you have finished reaching for it.
 */
const PLAY_IDLE_MS = 4_000;

/**
 * Keys for a window that can never have keyboard focus.
 *
 * The product's core guarantee is that the widget window is `focusable: false`, so every
 * keystroke lands in the terminal. That guarantee is also why the renderer never sees a
 * keydown: an unfocused window gets none. A global accelerator is the only way to read a
 * key here, and it is not free - while registered, a key goes to the widget *instead of*
 * the terminal, system wide.
 *
 * Three things keep that cost bounded:
 *
 * - **Arrows only, by default.** Never letters. WASD would make the widget eat ordinary
 *   typing, which would be indefensible; arrows cost you shell history and cursor
 *   movement, and only while a widget that asked for them is visibly on your screen.
 * - **Registered as late as possible.** Not at launch, not while the widget is merely
 *   visible - only while the widget showing *is* one that asked for keys. That is Snake
 *   and Tetris and nothing else (`wantsKeyboard`, with a test on the list). Every other
 *   toy, and every moment the window is hidden, leaves the keys alone.
 * - **Off switch.** `arrowKeys: false` in config.json disables this entirely, and both
 *   widgets stay fully playable by pointer.
 *
 * The action keys are the exception, and they need a fourth guard of their own. Space and
 * C are keys you type, so holding them for as long as Tetris happens to be on screen would
 * be exactly the trade the first rule refuses - a toy in the corner quietly eating the
 * space bar out of the sentence you are writing. So they are held only while somebody is
 * demonstrably playing: armed by a hand on the widget, and released again after
 * {@link PLAY_IDLE_MS} of quiet.
 *
 * A hand on the widget means either half of what playing looks like here - an arrow press,
 * or pointer input reported by the renderer through `arcade:playing`. Both are safe things
 * to key this off. The arrows are already the widget's while Tetris is up, so pressing one
 * cannot be somebody driving a terminal; and a pointer event means the cursor is inside a
 * 280-pixel square in the corner of the screen, which is not where a mouse sits while its
 * owner types. Keying it off the arrows alone was the first attempt and it was wrong: the
 * pointer is a whole control scheme here, and it left the drop key dead for everybody
 * playing with the mouse.
 *
 * What remains is narrow - Space does nothing if it is the very first thing you touch,
 * before an arrow or the cursor has been near the toy - and it is the price of not
 * holding the space bar hostage to a widget you were ignoring.
 *
 * Registration is best-effort: if another app already owns an accelerator, `register`
 * returns false, we leave it alone, and pointer steering carries the widget.
 */
export class KeyboardBridge {
  private active = false;
  /** Whether the widget on screen is one the action keys may ever be armed for. */
  private allowActions = false;
  /** Whether they are armed right now - i.e. somebody is mid-run on the keyboard. */
  private playing = false;
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onKey: (key: GameKey) => void) {}

  /**
   * Idempotent - safe to call on every reconcile.
   *
   * `actions` is a second, narrower question than `active`, not a stronger one: it says
   * whether the widget on screen would use the action keys if somebody started playing,
   * never that they should be taken now.
   */
  setActive(active: boolean, actions = false): void {
    if (active !== this.active) {
      if (active) this.register();
      else this.release();
    }
    this.allowActions = active && actions;
    // A widget swap that takes the action keys off the table takes them back at once,
    // rather than letting the outgoing game's last press keep them for four more seconds.
    if (!this.allowActions) this.disarm();
  }

  isActive(): boolean {
    return this.active;
  }

  /** Whether the action keys are held right now. For tests and for `status`. */
  isPlaying(): boolean {
    return this.playing;
  }

  private register(): void {
    this.active = true;
    for (const key of ARROWS) {
      try {
        // A failed registration is normal - something else on the desktop may own it.
        globalShortcut.register(key, () => this.fire(key));
      } catch {
        /* keep the other three */
      }
    }
  }

  private release(): void {
    this.active = false;
    this.disarm();
    for (const key of ARROWS) {
      try {
        globalShortcut.unregister(key);
      } catch {
        /* nothing held it */
      }
    }
  }

  /** A key arrived: pass it on, and take it as proof that somebody is playing. */
  private fire(key: GameKey): void {
    this.arm();
    this.onKey(key);
  }

  /**
   * Take the action keys, or push back the moment they go again.
   *
   * Public because a keypress is not the only proof that somebody is playing, and it was
   * a mistake to treat it as though it were: the pointer is a whole control scheme here,
   * and a player steering with the mouse would have pressed space against a key nobody
   * had picked up. The renderer reports a hand on the widget - see `arcade:playing` - and
   * that arms these exactly as an arrow does.
   *
   * The timer is reset by every press including the action keys' own, so a run spent
   * slamming pieces down keeps them just as a run spent steering does.
   */
  arm(): void {
    if (!this.allowActions) return;

    if (!this.playing) {
      this.playing = true;
      for (const { accelerator, key } of ACTIONS) {
        try {
          globalShortcut.register(accelerator, () => this.fire(key));
        } catch {
          /* keep the other one */
        }
      }
    }

    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.disarm(), PLAY_IDLE_MS);
  }

  /** Hand the action keys back. Safe to call when they were never taken. */
  private disarm(): void {
    if (this.idle) {
      clearTimeout(this.idle);
      this.idle = null;
    }
    if (!this.playing) return;
    this.playing = false;
    for (const { accelerator } of ACTIONS) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        /* nothing held it */
      }
    }
  }

  /**
   * Hand every key back unconditionally.
   *
   * Called on quit. A crash that skipped this would leave the desktop without arrow keys -
   * or worse, without a space bar - until the accelerators died with the process, so this
   * must not depend on `active` being accurate.
   */
  destroy(): void {
    this.active = false;
    this.allowActions = false;
    this.playing = false;
    if (this.idle) {
      clearTimeout(this.idle);
      this.idle = null;
    }
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* already gone */
    }
  }
}
