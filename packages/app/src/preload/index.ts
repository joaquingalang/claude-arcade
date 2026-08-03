import { contextBridge, ipcRenderer } from 'electron';

export interface ShowPayload {
  widgetId: string;
  /**
   * Increments on every swap, including a swap to the same id, so the renderer can tell
   * "play this again" apart from "nothing changed".
   */
  generation: number;
  /** The window box the main process just sized itself to, in CSS pixels. */
  width: number;
  height: number;
}

export interface ArcadeBridge {
  onShow(cb: (payload: ShowPayload) => void): void;
  onHide(cb: () => void): void;
  /** Replaces the previous handler rather than adding one - see below. */
  onKey(cb: (key: string) => void): void;
  dragStart(offset: { x: number; y: number }): void;
  dragMove(): void;
  dragEnd(): void;
  dismiss(): void;
  widgetDone(widgetId: string): void;
}

/**
 * The current key handler, swapped on each widget mount.
 *
 * `onShow`/`onHide` are subscribed once from App and can safely use `ipcRenderer.on`.
 * Keys are different: the handler belongs to whichever widget is mounted, and that
 * changes every rotation. Adding a listener per mount would leave the dead ones attached,
 * so a single listener dispatches to one replaceable callback instead.
 */
let keyHandler: ((key: string) => void) | null = null;
ipcRenderer.on('arcade:key', (_e, key: string) => keyHandler?.(key));

const bridge: ArcadeBridge = {
  onShow: (cb) => {
    ipcRenderer.on('arcade:show', (_e, payload: ShowPayload) => cb(payload));
  },
  onHide: (cb) => {
    ipcRenderer.on('arcade:hide', () => cb());
  },
  onKey: (cb) => {
    keyHandler = cb;
  },
  dragStart: (offset) => ipcRenderer.send('arcade:drag-start', offset),
  dragMove: () => ipcRenderer.send('arcade:drag-move'),
  dragEnd: () => ipcRenderer.send('arcade:drag-end'),
  dismiss: () => ipcRenderer.send('arcade:dismiss'),
  widgetDone: (widgetId) => ipcRenderer.send('arcade:widget-done', widgetId),
};

contextBridge.exposeInMainWorld('arcade', bridge);
