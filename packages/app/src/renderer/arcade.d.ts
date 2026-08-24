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
  /** Whether widgets may make noise, read fresh from config.json on every show. */
  soundEnabled: boolean;
  /** Whether the arrow keys will reach this widget - see the preload's ShowPayload. */
  keyboard: boolean;
}

export interface ArcadeBridge {
  onShow(cb: (payload: ShowPayload) => void): void;
  onHide(cb: () => void): void;
  /** Replaces the previous handler rather than adding one. */
  onKey(cb: (key: string) => void): void;
  dragStart(offset: { x: number; y: number }): void;
  dragMove(): void;
  dragEnd(): void;
  dismiss(): void;
  /** Tell main a hand is on this widget - see the preload's `playing`. */
  playing(): void;
  /** Tell main this widget's run is over and it is ready to hand over. */
  widgetDone(widgetId: string): void;
  /**
   * Ask the cycle clock to wait for a player who is midway through, or let it go again.
   *
   * Honoured only up to a cap in main, so a widget that forgets to let go cannot keep the
   * screen. See `CycleHold` in main/widget-ids.ts.
   */
  widgetHold(widgetId: string, holding: boolean): void;
  /** Bytes of one sound sample, or null if it is not installed. See main/samples.ts. */
  readSample(name: string): Promise<Uint8Array | null>;
}

declare global {
  interface Window {
    arcade: ArcadeBridge;
  }
}

export {};
