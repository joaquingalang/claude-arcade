import { create } from 'zustand';

/** Matches the default window box in main/widget-ids.ts; replaced by the first show. */
const DEFAULT_SIZE = 280;

interface ArcadeState {
  widgetId: string;
  /**
   * Which run of that widget this is. Changes even when the id does not, which is how a
   * finished game restarts in place under a pinned config.
   */
  generation: number;
  /** Canvas box for the current widget. The main process owns it; this mirrors it. */
  width: number;
  height: number;
  visible: boolean;
  setWidget(id: string, generation: number, width: number, height: number): void;
  hide(): void;
}

export const useArcadeStore = create<ArcadeState>((set) => ({
  widgetId: 'bubble-wrap',
  generation: 0,
  width: DEFAULT_SIZE,
  height: DEFAULT_SIZE,
  visible: false,
  // A show always names the widget and its box, so the facts update together.
  setWidget: (id, generation, width, height) =>
    set({ widgetId: id, generation, width, height, visible: true }),
  hide: () => set({ visible: false }),
}));
