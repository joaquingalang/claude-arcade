import { setSoundEnabled } from './audio';
import { WIDGET_REGISTRY, createWidget } from './widgets/registry';
import type { ArrowKey, CanvasWidget } from './widgets/types';

const SIZE = 280;
const live = new Map<string, CanvasWidget>();
/** The widget the pointer is over, which is the one the arrow keys mean. */
let focused: CanvasWidget | null = null;

const params = new URLSearchParams(location.search);
const only = params.get('only');

// There is no config.json here, so sound is opt-in per load: ?sound=1. Off by default,
// because the harness renders every widget at once and this is a page you leave open.
setSoundEnabled(params.get('sound') === '1');

for (const [id, entry] of Object.entries(WIDGET_REGISTRY)) {
  if (only && !only.split(',').includes(id)) continue;
  const figure = document.createElement('figure');
  const canvas = document.createElement('canvas');
  const caption = document.createElement('figcaption');
  caption.textContent = entry.label;

  const width = id === 'newtons-cradle' ? 400 : SIZE;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(SIZE * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${SIZE}px`;

  figure.append(canvas, caption);
  document.body.append(figure);

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const widget = createWidget(id);
  live.set(id, widget);
  widget.start(ctx, {
    width,
    height: SIZE,
    // True here and only here: this page has focus of its own, so the arrows really do
    // reach a widget - no global accelerator, and no config to have switched off.
    keyboard: true,
    onDone: () => {
      caption.textContent = `${entry.label} - done`;
    },
    // No cycle clock here to hold, so the caption stands in for one: a widget that asks
    // for a wait and forgets to let go is the failure worth seeing, and it is invisible
    // without something on screen saying so.
    onHold: (holding) => {
      caption.textContent = holding ? `${entry.label} - holding` : entry.label;
    },
  });

  const at = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = at(e);
    canvas.setPointerCapture(e.pointerId);
    widget.onPointerDown(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = at(e);
    widget.onPointerMove(p.x, p.y);
  });
  canvas.addEventListener('pointerup', (e) => {
    const p = at(e);
    widget.onPointerUp(p.x, p.y);
  });
  canvas.addEventListener('pointerenter', () => {
    focused = widget;
  });
}

/**
 * Arrow keys for whichever widget the pointer is over.
 *
 * In the app the arrows come from a global accelerator and only one widget is on screen,
 * so there is nothing to choose between. Here a dozen are up at once, and hovering is the
 * one gesture that already means "this one". Without this the keyboard half of Snake and
 * Tetris could only be tried by launching Electron.
 */
const ARROWS: Record<string, ArrowKey> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
};

window.addEventListener('keydown', (e) => {
  const key = ARROWS[e.key];
  if (!key || !focused) return;
  // Or the page scrolls out from under the widget being played.
  e.preventDefault();
  focused.onKey(key);
});

// Poked from the console to drive a widget's internals while looking at it.
(window as unknown as { widgets: Map<string, CanvasWidget> }).widgets = live;
