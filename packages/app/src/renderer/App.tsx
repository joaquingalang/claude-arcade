import { useEffect } from 'react';

import { WidgetCanvas } from './WidgetCanvas';
import { useArcadeStore } from './store';

/** Height of the drag strip along the top edge. */
const GRIP_HEIGHT = 22;

export function App() {
  const { widgetId, generation, width, height, visible, setWidget, hide } = useArcadeStore();

  useEffect(() => {
    window.arcade.onShow((p) => setWidget(p.widgetId, p.generation, p.width, p.height));
    window.arcade.onHide(() => hide());
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
        paused={!visible}
      />
    </div>
  );
}
