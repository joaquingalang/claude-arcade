import { useEffect, useRef } from 'react';

import { createWidget } from './widgets/registry';
import type { CanvasWidget } from './widgets/types';

interface Props {
  widgetId: string;
  /** Bumped by main to force a fresh run of the same widget. */
  generation: number;
  width: number;
  height: number;
  paused: boolean;
}

const ARROW_KEYS = new Set(['Up', 'Down', 'Left', 'Right']);

export function WidgetCanvas({ widgetId, generation, width, height, paused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const widgetRef = useRef<CanvasWidget | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // DPR-aware sizing: without this the canvas is blurry on scaled displays, which is
    // most Windows laptops.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const widget = createWidget(widgetId);
    widgetRef.current = widget;
    widget.start(ctx, {
      width,
      height,
      // Main decides what happens next - rotate, or restart this same game in place.
      onDone: () => window.arcade.widgetDone(widgetId),
      // And whether to wait, when the widget says someone is midway through it.
      onHold: (holding) => window.arcade.widgetHold(widgetId, holding),
    });

    // Replaces the previous handler, so the widget being torn down stops receiving keys.
    window.arcade.onKey((key) => {
      if (ARROW_KEYS.has(key)) widgetRef.current?.onKey(key as 'Up' | 'Down' | 'Left' | 'Right');
    });

    return () => {
      widget.stop();
      widgetRef.current = null;
    };
    // generation is in the deps on purpose: a finished game handing over to itself keeps
    // the same id, and without it React would keep the dead board mounted.
  }, [widgetId, generation, width, height]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return;
    if (paused) widget.pause();
    else widget.resume();
  }, [paused]);

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvasRef}
      className="widget-canvas"
      onPointerDown={(e) => {
        const { x, y } = toCanvas(e);
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        widgetRef.current?.onPointerDown(x, y);
      }}
      onPointerMove={(e) => {
        const { x, y } = toCanvas(e);
        widgetRef.current?.onPointerMove(x, y);
      }}
      onPointerUp={(e) => {
        const { x, y } = toCanvas(e);
        draggingRef.current = false;
        widgetRef.current?.onPointerUp(x, y);
      }}
      onPointerLeave={(e) => {
        if (!draggingRef.current) return;
        const { x, y } = toCanvas(e);
        draggingRef.current = false;
        widgetRef.current?.onPointerUp(x, y);
      }}
    />
  );
}
