import { globalShortcut } from 'electron';

import type { ArrowKey } from './widget-ids';

const ARROWS: ArrowKey[] = ['Up', 'Down', 'Left', 'Right'];

/**
 * Arrow keys for a window that can never have keyboard focus.
 *
 * The product's core guarantee is that the widget window is `focusable: false`, so every
 * keystroke lands in the terminal. That guarantee is also why the renderer never sees a
 * keydown: an unfocused window gets none. A global accelerator is the only way to read a
 * key here, and it is not free - while registered, the four arrow keys go to the snake
 * *instead of* the terminal, system wide.
 *
 * Three things keep that cost bounded:
 *
 * - **Arrows only.** Never letters. WASD would make the widget eat ordinary typing, which
 *   would be indefensible; arrows cost you shell history and cursor movement, and only
 *   while a snake is visibly on your screen.
 * - **Registered as late as possible.** Not at launch, not while the widget is merely
 *   visible - only while the widget showing *is* one that asked for keys. Every other toy,
 *   and every moment the window is hidden, leaves the keys alone.
 * - **Off switch.** `snakeKeyboard: false` in config.json disables this entirely and
 *   Snake stays fully playable by pointer.
 *
 * Registration is best-effort: if another app already owns an arrow accelerator,
 * `register` returns false, we leave it alone, and pointer steering carries the widget.
 */
export class KeyboardBridge {
  private active = false;

  constructor(private readonly onKey: (key: ArrowKey) => void) {}

  /** Idempotent - safe to call on every reconcile. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    if (active) this.register();
    else this.release();
  }

  isActive(): boolean {
    return this.active;
  }

  private register(): void {
    this.active = true;
    for (const key of ARROWS) {
      try {
        // A failed registration is normal - something else on the desktop may own it.
        globalShortcut.register(key, () => this.onKey(key));
      } catch {
        /* keep the other three */
      }
    }
  }

  private release(): void {
    this.active = false;
    for (const key of ARROWS) {
      try {
        globalShortcut.unregister(key);
      } catch {
        /* nothing held it */
      }
    }
  }

  /**
   * Hand the arrows back unconditionally.
   *
   * Called on quit. A crash that skipped this would leave the desktop without arrow keys
   * until the accelerators died with the process, so this must not depend on `active`
   * being accurate.
   */
  destroy(): void {
    this.active = false;
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* already gone */
    }
  }
}
