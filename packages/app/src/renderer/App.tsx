import { useEffect } from 'react';

import { WidgetCanvas } from './WidgetCanvas';
import { setSoundEnabled, suspendSound } from './audio';
import { useArcadeStore } from './store';

/** Height of the drag strip along the top edge. */
const GRIP_HEIGHT = 22;

export function App() {
  const { widgetId, generation, width, height, visible, keyboard, setWidget, hide } =
    useArcadeStore();

  useEffect(() => {
    window.arcade.onShow((p) => {
      // Applied before the widget mounts, so the samples are decoding while the first
      // bubble is still being drawn.
      setSoundEnabled(p.soundEnabled);
      setWidget(p.widgetId, p.generation, p.width, p.height, p.keyboard);
    });
    window.arcade.onHide(() => {
      suspendSound();
      hide();
    });
  }, [setWidget, hide]);

  return (
    <div className="root" style={{ width, height }}>
      <div
        className="grip"
        style={{ height: GRIP_HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          // Offset within the window, so the widget doesn't jump to the cursor.
          window.arcade.dragStart({ x: e.clientX, y: e.clientY });
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0) return;
          window.arcade.dragMove();
        }}
        onPointerUp={() => window.arcade.dragEnd()}
      >
        <span className="grip-dots" />
      </div>

      {/* Pointer down, not click: this window never takes focus, and every other
          control here is pointer-driven for the same reason. */}
      <button
        className="dismiss"
        type="button"
        aria-label="Dismiss"
        onPointerDown={(e) => {
          e.stopPropagation();
          window.arcade.dismiss();
        }}
      >
        &times;
      </button>

      <WidgetCanvas
        widgetId={widgetId}
        generation={generation}
        width={width}
        height={height}
        keyboard={keyboard}
        paused={!visible}
      />
    </div>
  );
}
