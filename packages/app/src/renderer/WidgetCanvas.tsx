import { useEffect, useRef } from 'react';

import { createWidget } from './widgets/registry';
import type { CanvasWidget, GameKey } from './widgets/types';

interface Props {
  widgetId: string;
  /** Bumped by main to force a fresh run of the same widget. */
  generation: number;
  width: number;
  height: number;
  /** Whether the game keys reach this widget, passed on so it can say so on screen. */
  keyboard: boolean;
  paused: boolean;
}

/**
 * Filtered rather than forwarded blind: this is an IPC channel, and a widget's `onKey`
 * is typed as if only these can arrive.
 */
const GAME_KEYS = new Set<string>(['Up', 'Down', 'Left', 'Right', 'Drop', 'Hold']);

/**
 * How often a hand resting on the widget re-reports itself to main.
 *
 * Every pointer event would be an IPC message per mouse move, which for a signal that
 * only has to arrive *sometimes* is a silly amount of traffic. Comfortably shorter than
 * the grab it keeps alive, so a hand that stays on the widget never lets it lapse.
 */
const PLAYING_PING_MS = 1_000;

export function WidgetCanvas({ widgetId, generation, width, height, keyboard, paused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const widgetRef = useRef<CanvasWidget | null>(null);
  const draggingRef = useRef(false);
  const pingedRef = useRef(0);

  /**
   * Tell main a hand is on this widget, so it can hold the keys a player would want next.
   *
   * Sent for pointer input rather than only for keys because the pointer is a whole
   * control scheme here: somebody steering Tetris with the mouse has never touched an
   * arrow, and would find the drop key dead if a keypress were the only thing that counted
   * as playing. Main ignores this for every widget that has not asked for those keys.
   */
  const reportPlaying = (force = false) => {
    const now = performance.now();
    if (!force && now - pingedRef.current < PLAYING_PING_MS) return;
    pingedRef.current = now;
    window.arcade.playing();
  };

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
      keyboard,
      // Main decides what happens next - rotate, or restart this same game in place.
      onDone: () => window.arcade.widgetDone(widgetId),
      // And whether to wait, when the widget says someone is midway through it.
      onHold: (holding) => window.arcade.widgetHold(widgetId, holding),
    });

    // Replaces the previous handler, so the widget being torn down stops receiving keys.
    window.arcade.onKey((key) => {
      if (GAME_KEYS.has(key)) widgetRef.current?.onKey(key as GameKey);
    });

    return () => {
      widget.stop();
      widgetRef.current = null;
    };
    // generation is in the deps on purpose: a finished game handing over to itself keeps
    // the same id, and without it React would keep the dead board mounted.
  }, [widgetId, generation, width, height, keyboard]);

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
        // Forced: a press is the least ambiguous thing anybody does to a widget, and it
        // must not be the one that happened to land inside a throttle window.
        reportPlaying(true);
        widgetRef.current?.onPointerDown(x, y);
      }}
      onPointerMove={(e) => {
        const { x, y } = toCanvas(e);
        reportPlaying();
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
