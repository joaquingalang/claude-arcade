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
  /**
   * Whether widgets may make noise, read fresh from config.json on every show.
   *
   * Sent with the show rather than once at startup so editing the file takes effect on
   * the next appearance instead of the next launch.
   */
  soundEnabled: boolean;
  /**
   * Whether the arrow keys will reach this widget.
   *
   * Both halves of the answer live in main - which widgets ask for keys, and whether the
   * user left the grab switched on - so a widget that draws its own controls has no way
   * to work it out, and one that guessed would be teaching half its users a control that
   * does nothing.
   */
  keyboard: boolean;
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
  widgetHold(widgetId: string, holding: boolean): void;
  /**
   * The bytes of one sound sample, or null if it is not installed.
   *
   * The renderer runs on a `file://` origin, where `fetch` refuses the scheme, so the
   * main process does the reading - see main/samples.ts.
   */
  readSample(name: string): Promise<Uint8Array | null>;
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
  widgetHold: (widgetId, holding) => ipcRenderer.send('arcade:widget-hold', widgetId, holding),
  readSample: (name) => ipcRenderer.invoke('arcade:read-sample', name),
};

contextBridge.exposeInMainWorld('arcade', bridge);
