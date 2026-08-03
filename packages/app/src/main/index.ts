import * as path from 'node:path';

import { app, ipcMain, screen } from 'electron';

import {
  APP_ID,
  clearRuntimeFile,
  runtimeFilePath,
  writeRuntimeFile,
} from '@claude-arcade/shared';

import { ConfigStore } from './config';
import { SessionStore } from './session-store';
import { startServer, type RunningServer } from './server';
import { WidgetWindow } from './widget-window';
import { KeyboardBridge } from './keyboard';
import {
  WIDGET_IDS,
  WidgetRotation,
  isSelfPaced,
  wantsKeyboard,
  type ArrowKey,
} from './widget-ids';

const VERSION = '0.1.0';
const REAP_INTERVAL_MS = 15_000;

let server: RunningServer | null = null;
let widgetWindow: WidgetWindow | null = null;
let sessions: SessionStore;
let config: ConfigStore;
let showTimer: NodeJS.Timeout | null = null;
let cycleTimer: NodeJS.Timeout | null = null;
let currentWidgetId: string = WIDGET_IDS[0];
let keyboard: KeyboardBridge | null = null;
/**
 * Lives for the whole app run, not per appearance: the toy/game alternation and the
 * shuffle bags behind it only even out over many draws, and a fresh one each time the
 * window opened would put the sequence back at square one on every short turn.
 */
const rotation = new WidgetRotation();
/**
 * Bumped on every swap, including a swap to the same id.
 *
 * A finished game that is pinned - or running with cycling off - has to restart in place,
 * and the renderer keys its canvas on this so "same widget again" still means a fresh
 * board rather than a no-op.
 */
let generation = 0;
/** The user waved this appearance away. Cleared as soon as the work stops. */
let dismissed = false;

// A second instance would fight over the port and the runtime file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function stopCycle(): void {
  if (!cycleTimer) return;
  clearTimeout(cycleTimer);
  cycleTimer = null;
}

/** True when the config wants the toy to move on by itself at all. */
function rotationEnabled(): boolean {
  const { widget, cycleMs } = config.get();
  // A pinned widget is a choice, not a suggestion; only 'random' rotates.
  return widget === 'random' && cycleMs > 0;
}

/**
 * Keep the arrow-key grab in step with what is actually on screen.
 *
 * Cheap and idempotent, so it can be called from every path that changes the widget or
 * its visibility rather than each of them having to reason about the others.
 */
function syncKeyboard(): void {
  const want =
    (widgetWindow?.isVisible() ?? false) &&
    wantsKeyboard(currentWidgetId) &&
    config.get().snakeKeyboard;
  keyboard?.setActive(want);
}

/** Swap in `id` and re-arm whatever paces it next. */
function showWidget(id: string): void {
  currentWidgetId = id;
  generation++;
  widgetWindow?.setWidget(id, generation);
  scheduleCycle();
  syncKeyboard();
}

/**
 * Arm whatever moves the current toy along.
 *
 * A timeout that re-arms on each swap, not a single interval: the two kinds of widget are
 * paced differently, so how long the current one gets depends on which one it is.
 *
 * Armed on appearance and on each swap. Rearming from reconcile() would let a busy turn's
 * hook traffic reset the clock on every tool call, and nothing would ever rotate.
 */
function scheduleCycle(): void {
  stopCycle();
  if (!rotationEnabled()) return;
  // A game is on its own clock. It reports in via arcade:widget-done when the run ends,
  // and until then nothing is allowed to cut it short.
  if (isSelfPaced(currentWidgetId)) return;

  cycleTimer = setTimeout(() => {
    if (!widgetWindow?.isVisible()) {
      stopCycle();
      return;
    }
    showWidget(rotation.next(config.get().widget));
  }, config.get().cycleMs);
}

/**
 * A self-paced widget finished its run.
 *
 * `id` is checked against the current one because the report races the swap: a game that
 * ends in the same breath as a dismissal would otherwise rotate whatever replaced it.
 *
 * When rotation is off the game restarts in place instead. Leaving a finished board on
 * screen for the rest of a long turn would be the worst of both worlds.
 */
function onWidgetDone(id: string): void {
  if (id !== currentWidgetId) return;
  if (!widgetWindow?.isVisible()) return;
  showWidget(rotationEnabled() ? rotation.next(config.get().widget) : currentWidgetId);
}

/**
 * Reconcile window visibility with session state.
 *
 * Called after every event. Cheap and idempotent, so it's safe to call redundantly -
 * that's preferable to trying to work out which transitions matter.
 */
function reconcile(): void {
  if (!widgetWindow) return;

  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }

  const wantVisible = sessions.shouldShowWidget();
  // A dismissal covers this stretch of work only. Once everything goes quiet the next
  // turn starts clean, so waving the toy away never feels like turning it off for good.
  if (!wantVisible) dismissed = false;

  if (wantVisible && !dismissed) {
    if (!widgetWindow.isVisible()) {
      currentWidgetId = rotation.next(config.get().widget);
      generation++;
      widgetWindow.show(currentWidgetId, generation);
      scheduleCycle();
      syncKeyboard();
    }
    return;
  }

  stopCycle();
  widgetWindow.hide();
  // Hand the arrow keys back the moment the toy goes away, not whenever the next event
  // happens to arrive.
  syncKeyboard();

  // Still working, just unwanted. Scheduling here would spin: the delay has already
  // elapsed, so msUntilNextShow() returns 0 and we'd re-enter every 10ms.
  if (dismissed) return;

  // Something is working but hasn't crossed the delay yet - wake up when it does.
  const wait = sessions.msUntilNextShow();
  if (wait !== null) {
    showTimer = setTimeout(reconcile, Math.max(wait, 10));
  }
}

async function bootstrap(): Promise<void> {
  config = new ConfigStore(path.join(app.getPath('userData'), 'config.json'));
  sessions = new SessionStore({ showDelayMs: config.get().showDelayMs });

  server = await startServer(
    {
      onHook: (payload, token) => {
        sessions.apply(payload, token);
        reconcile();
      },
      onSessionRegistered: (pid, cwd, token) => {
        sessions.registerLauncher(pid, cwd, token);
      },
      onSessionEnded: (token) => {
        sessions.unregisterLauncher(token);
        reconcile();
      },
      status: () => ({
        widgetVisible: widgetWindow?.isVisible() ?? false,
        widgetId: currentWidgetId,
        sessions: sessions.all(),
      }),
    },
    VERSION,
  );

  writeRuntimeFile({ app: APP_ID, port: server.port, ownerPid: process.pid });

  widgetWindow = new WidgetWindow(
    path.join(__dirname, '..', 'renderer', 'index.html'),
    path.join(__dirname, '..', 'preload', 'index.js'),
    (pos) => config.update({ position: pos }),
  );
  widgetWindow.create(config.get().position);

  keyboard = new KeyboardBridge((key: ArrowKey) => {
    widgetWindow?.sendKey(key);
  });

  setInterval(() => {
    sessions.reap();
    reconcile();
  }, REAP_INTERVAL_MS);
}

app.whenReady().then(() => {
  ipcMain.on('arcade:drag-start', (_e, offset: { x: number; y: number }) => {
    widgetWindow?.beginDrag(offset);
  });
  ipcMain.on('arcade:drag-move', () => {
    // The cursor position comes from the main process, not the renderer: a
    // non-focusable window's pointer events stop firing once the cursor leaves it.
    widgetWindow?.dragTo(screen.getCursorScreenPoint());
  });
  ipcMain.on('arcade:drag-end', () => {
    widgetWindow?.endDrag();
  });
  ipcMain.on('arcade:dismiss', () => {
    dismissed = true;
    stopCycle();
    widgetWindow?.hide();
    syncKeyboard();
  });
  ipcMain.on('arcade:widget-done', (_e, id: string) => {
    onWidgetDone(id);
  });

  bootstrap().catch((err) => {
    process.stderr.write(`claude-arcade: failed to start: ${String(err)}\n`);
    app.quit();
  });
});

// This app has no windows in the conventional sense; it lives until told otherwise.
app.on('window-all-closed', () => {
  /* keep running */
});

function shutdown(): void {
  clearRuntimeFile(process.pid, runtimeFilePath());
  void server?.close();
  // Before the window goes: never exit still holding the desktop's arrow keys.
  keyboard?.destroy();
  widgetWindow?.destroy();
}

app.on('before-quit', shutdown);
process.on('exit', shutdown);
