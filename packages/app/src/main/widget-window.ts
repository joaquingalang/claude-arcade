import { BrowserWindow, screen } from 'electron';

import { WIDGET_BASE_SIZE, widgetBounds, type WidgetBounds } from './widget-ids';

const SCREEN_MARGIN = 24;
/** Roughly the Windows taskbar, so the default position doesn't sit under it. */
const TASKBAR_ALLOWANCE = 56;

export class WidgetWindow {
  private win: BrowserWindow | null = null;
  private visible = false;
  private dragOffset: { x: number; y: number } | null = null;
  /**
   * Top-left of the *base* square, not of the current window.
   *
   * Widgets have different box widths, so storing the raw window position would make the
   * saved spot mean something different depending on which toy happened to be up when
   * the user let go of the drag.
   */
  private anchor: { x: number; y: number } = { x: 0, y: 0 };
  private bounds: WidgetBounds = { width: WIDGET_BASE_SIZE, height: WIDGET_BASE_SIZE };

  constructor(
    private readonly rendererPath: string,
    private readonly preloadPath: string,
    private readonly onPositionChanged: (pos: { x: number; y: number }) => void,
    /** Read per show, not captured once, so a config edit lands on the next appearance. */
    private readonly isSoundEnabled: () => boolean = () => false,
  ) {}

  /**
   * Build the window once, hidden, at startup.
   *
   * Constructing a BrowserWindow per turn would cost hundreds of milliseconds and
   * destroy the "instant" feel that is the whole point of the product.
   */
  create(initialPosition: { x: number; y: number } | null): void {
    if (this.win) return;

    this.anchor = initialPosition ?? this.defaultPosition();
    const pos = this.anchor;

    this.win = new BrowserWindow({
      width: this.bounds.width,
      height: this.bounds.height,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // The core guarantee: this window can receive mouse events but never keyboard
      // focus, so every keystroke continues to land in the user's terminal.
      focusable: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // 'screen-saver' is the level that stays above full-screen terminals.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // This window is hidden by default, so a renderer that fails to load looks
    // identical to one that works. Surface it rather than debugging it blind.
    this.win.webContents.on('did-fail-load', (_e, code, desc) => {
      process.stderr.write(`claude-arcade: renderer failed to load (${code}): ${desc}\n`);
    });
    this.win.webContents.on('render-process-gone', (_e, details) => {
      process.stderr.write(`claude-arcade: renderer gone: ${details.reason}\n`);
    });
    if (process.env.ARCADE_DEBUG) {
      this.win.webContents.on('console-message', (_e, _level, message) => {
        process.stderr.write(`claude-arcade[renderer]: ${message}\n`);
      });
      this.win.webContents.on('did-finish-load', () => {
        process.stderr.write('claude-arcade: renderer loaded\n');
      });
    }

    void this.win.loadFile(this.rendererPath);

    this.win.on('closed', () => {
      this.win = null;
      this.visible = false;
    });
  }

  /** Bottom-right of the work area, expressed as the base square's corner. */
  private defaultPosition(): { x: number; y: number } {
    const { workArea } = screen.getPrimaryDisplay();
    return {
      x: workArea.x + workArea.width - WIDGET_BASE_SIZE - SCREEN_MARGIN,
      y: workArea.y + workArea.height - WIDGET_BASE_SIZE - SCREEN_MARGIN - TASKBAR_ALLOWANCE,
    };
  }

  /**
   * Resize the window to the incoming widget's box and tell the renderer about it.
   *
   * A wider box grows around the base square's centre rather than off its left edge, so
   * a toy that needs the extra room stays visually where the user parked it. The result
   * is clamped into the work area: without that, the default bottom-right position would
   * push the wide box straight off the side of the screen.
   */
  private applyWidget(widgetId: string, generation: number): void {
    if (!this.win) return;
    this.bounds = widgetBounds(widgetId);

    const { workArea } = screen.getPrimaryDisplay();
    const spread = (this.bounds.width - WIDGET_BASE_SIZE) / 2;
    const x = Math.round(
      Math.min(
        Math.max(this.anchor.x - spread, workArea.x),
        workArea.x + workArea.width - this.bounds.width,
      ),
    );
    const y = Math.round(
      Math.min(
        Math.max(this.anchor.y, workArea.y),
        workArea.y + workArea.height - this.bounds.height,
      ),
    );

    this.win.setBounds({ x, y, width: this.bounds.width, height: this.bounds.height });
    this.win.webContents.send('arcade:show', {
      widgetId,
      generation,
      ...this.bounds,
      soundEnabled: this.isSoundEnabled(),
    });
  }

  show(widgetId: string, generation: number): void {
    if (!this.win || this.visible) return;
    this.applyWidget(widgetId, generation);
    // showInactive, never show(): show() would focus the window and steal keystrokes
    // mid-sentence, which is the one thing this product must never do.
    this.win.showInactive();
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.visible = true;
  }

  /**
   * Swap the toy without touching visibility.
   *
   * `show()` bails out when already visible, so the cycle timer needs its own way to
   * hand the renderer a new id mid-appearance.
   */
  setWidget(widgetId: string, generation: number): void {
    if (!this.win || !this.visible) return;
    this.applyWidget(widgetId, generation);
  }

  /** Forward a globally grabbed arrow key to whatever is on the canvas. */
  sendKey(key: string): void {
    if (!this.win || !this.visible) return;
    this.win.webContents.send('arcade:key', key);
  }

  hide(): void {
    if (!this.win || !this.visible) return;
    this.win.webContents.send('arcade:hide');
    this.win.hide();
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Manual dragging.
   *
   * `-webkit-app-region: drag` is unreliable on a transparent, non-focusable window on
   * Windows, so the renderer reports pointer deltas and we move the window ourselves.
   */
  beginDrag(offset: { x: number; y: number }): void {
    this.dragOffset = offset;
  }

  dragTo(cursor: { x: number; y: number }): void {
    if (!this.win || !this.dragOffset) return;
    this.win.setPosition(
      Math.round(cursor.x - this.dragOffset.x),
      Math.round(cursor.y - this.dragOffset.y),
    );
  }

  endDrag(): void {
    if (!this.win || !this.dragOffset) return;
    this.dragOffset = null;
    const [x = 0, y = 0] = this.win.getPosition();
    // Back out the current widget's extra width, so what gets stored is the base square's
    // corner and the toy reappears where it was dropped whatever is showing next time.
    this.anchor = { x: Math.round(x + (this.bounds.width - WIDGET_BASE_SIZE) / 2), y };
    this.onPositionChanged(this.anchor);
  }

  destroy(): void {
    this.win?.destroy();
    this.win = null;
  }
}
