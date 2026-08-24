import * as path from 'node:path';

import { app, ipcMain, screen } from 'electron';

import {
  APP_ID,
  clearRuntimeFile,
  runtimeFilePath,
  writeRuntimeFile,
} from '@claude-arcade/shared';

import { ConfigStore } from './config';
import { readSample } from './samples';
import { SessionStore } from './session-store';
import { startServer, type RunningServer } from './server';
import { WidgetWindow } from './widget-window';
import { KeyboardBridge } from './keyboard';
import {
  CycleHold,
  HOLD_RECHECK_MS,
  WIDGET_IDS,
  WidgetRotation,
  isSelfPaced,
  wantsActionKeys,
  wantsKeyboard,
  type GameKey,
} from './widget-ids';

const VERSION = '0.1.0';
const REAP_INTERVAL_MS = 15_000;
/** Vite copies `renderer/public/sounds` here verbatim, alongside the built index.html. */
const SOUNDS_DIR = path.join(__dirname, '..', 'renderer', 'sounds');

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
 * Whether the widget on screen has asked the clock to wait for a player mid-something.
 *
 * Only ever set by the widget currently up, and cleared by every path that takes it away,
 * so a hold cannot outlive the board it was asked for.
 */
const hold = new CycleHold();
/**
 * Bumped on every swap, including a swap to the same id.
 *
 * A finished game that is pinned - or running with cycling off - has to restart in place,
 * and the renderer keys its canvas on this so "same widget again" still means a fresh
 * board rather than a no-op.
 */
let generation = 0;
/**
 * The prompt count when the user waved the widget away, or null if they never have.
 *
 * Dated rather than a flag, because the question "is this dismissal still in force?" has
 * to survive everything that happens between the click and the next prompt: the turn
 * ending, a lull while Claude waits on the user, stray hook events arriving late. Any of
 * those clearing a plain boolean is a widget springing back onto a desktop someone just
 * closed it on. Only a new prompt moves the count, so only a new prompt lets it back.
 */
let dismissedAtPrompt: number | null = null;

/** True while the user's dismissal still covers the current stretch of work. */
function isDismissed(): boolean {
  return dismissedAtPrompt !== null && dismissedAtPrompt === sessions.promptCount();
}

/**
 * A widget the user asked for by name with `arcade play`, or null for the usual behaviour.
 *
 * It outranks session state in both directions: it appears with nothing working, and it
 * survives a turn that would otherwise have rotated it away. That asymmetry is the whole
 * point of the command - `arcade play snake` is someone deciding they want a game now,
 * not a suggestion about what to show next time Claude is busy. Only a dismissal or
 * `arcade stop` takes it back.
 */
let handPicked: string | null = null;

// A second instance would fight over the port and the runtime file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function stopCycle(): void {
  if (!cycleTimer) return;
  clearTimeout(cycleTimer);
  cycleTimer = null;
}

function clearShowTimer(): void {
  if (!showTimer) return;
  clearTimeout(showTimer);
  showTimer = null;
}

/** True when the config wants the toy to move on by itself at all. */
function rotationEnabled(): boolean {
  // Asking for a widget by name is the strongest form of the same choice a pin makes.
  if (handPicked !== null) return false;
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
    config.get().arrowKeys;
  // The action keys are a second question, answered per widget: only Tetris has anything
  // to do with them, and even there the bridge only takes them once somebody is playing.
  keyboard?.setActive(want, want && wantsActionKeys(currentWidgetId));
}

/** Swap in `id` and re-arm whatever paces it next. */
function showWidget(id: string): void {
  currentWidgetId = id;
  generation++;
  // The outgoing board's hold goes with it. The incoming widget asks for its own if it
  // wants one, and nothing else may inherit a wait it never requested.
  hold.clear();
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

  armCycle(config.get().cycleMs);
}

/**
 * The cycle timeout itself, which may re-arm for a shorter look rather than swap.
 *
 * A toy someone is midway through solving asks the clock to wait (`arcade:widget-hold`),
 * and the swap that comes due during that goes back to sleep for a second at a time
 * instead. Deferring rather than disarming is what keeps this bounded: `CycleHold` stops
 * blocking once its cap is spent, so the loop always ends in a swap.
 */
function armCycle(ms: number): void {
  cycleTimer = setTimeout(() => {
    if (!widgetWindow?.isVisible()) {
      stopCycle();
      return;
    }
    if (hold.blocks(currentWidgetId)) {
      armCycle(HOLD_RECHECK_MS);
      return;
    }
    showWidget(rotation.next(config.get().widget));
  }, ms);
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
 * Put a named widget up and keep it there - `arcade play <id>`.
 *
 * Swaps in place when the window is already up rather than hiding and showing again, so
 * playing one game straight after another doesn't blink the window off the desktop
 * between them.
 */
function startPlaying(id: string): void {
  if (!widgetWindow) return;

  handPicked = id;
  // A dismissal covers one stretch of work. It must never swallow a request made after
  // it - typing `arcade play snake` and getting nothing would read as a broken command.
  dismissedAtPrompt = null;
  clearShowTimer();
  stopCycle();
  hold.clear();

  currentWidgetId = id;
  generation++;
  if (widgetWindow.isVisible()) widgetWindow.setWidget(id, generation);
  else widgetWindow.show(id, generation);

  syncKeyboard();
}

/** Hand the window back to session state, whatever it happens to want right now. */
function stopPlaying(): void {
  if (handPicked === null) return;
  handPicked = null;
  // Hidden before reconciling, so a session that is mid-turn draws a fresh widget from
  // the rotation instead of inheriting the hand-picked one.
  widgetWindow?.hide();
  reconcile();
}

/**
 * Reconcile window visibility with session state.
 *
 * Called after every event. Cheap and idempotent, so it's safe to call redundantly -
 * that's preferable to trying to work out which transitions matter.
 */
function reconcile(): void {
  if (!widgetWindow) return;

  clearShowTimer();

  // A hand-picked widget answers to `arcade stop` and the dismiss button, not to Claude.
  if (handPicked !== null) return;

  const wantVisible = sessions.shouldShowWidget() && !isDismissed();

  if (wantVisible) {
    if (!widgetWindow.isVisible()) {
      currentWidgetId = rotation.next(config.get().widget);
      generation++;
      // As in showWidget: a fresh board starts owing the clock nothing.
      hold.clear();
      widgetWindow.show(currentWidgetId, generation);
      scheduleCycle();
      syncKeyboard();
    }
    return;
  }

  stopCycle();
  hold.clear();
  widgetWindow.hide();
  // Hand the arrow keys back the moment the toy goes away, not whenever the next event
  // happens to arrive.
  syncKeyboard();

  // Still working, just unwanted. Scheduling here would spin: the delay has already
  // elapsed, so msUntilNextShow() returns 0 and we'd re-enter every 10ms. The next
  // prompt calls reconcile() again anyway, which is exactly when this expires.
  if (isDismissed()) return;

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
      onPlay: (widgetId) => {
        startPlaying(widgetId);
      },
      onStopPlaying: () => {
        stopPlaying();
      },
      status: () => ({
        widgetVisible: widgetWindow?.isVisible() ?? false,
        widgetId: currentWidgetId,
        playing: handPicked,
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
    () => config.get().soundEnabled,
    // Not `keyboard.isActive()`: this answers what the widget being shown may expect,
    // which is settled before the grab itself is reconciled.
    (id) => wantsKeyboard(id) && config.get().arrowKeys,
  );
  widgetWindow.create(config.get().position);

  keyboard = new KeyboardBridge((key: GameKey) => {
    widgetWindow?.sendKey(key);
  });

  setInterval(() => {
    sessions.reap();
    reconcile();
  }, REAP_INTERVAL_MS);
}

app.whenReady().then(() => {
  // macOS hands every app a Dock icon and a Cmd+Tab slot. This one has earned neither:
  // there is no window to raise, no menu bar worth reaching, and it is started by a CLI
  // wrapper rather than by somebody opening it - so the icon is a bouncing advert for a
  // process the user never launched, and Cmd+Tabbing to it does nothing at all. Hiding
  // it makes this an accessory app, which is what `skipTaskbar` has quietly been doing
  // on Windows all along; macOS ignores that option and wants this instead.
  app.dock?.hide();

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
  // A hand on the widget, which is the other half of "somebody is playing" - the first
  // half being a keypress. Ignored unless the widget on screen asked for the action keys,
  // which `arm` decides for itself, so this stays a one-liner.
  ipcMain.on('arcade:playing', () => {
    keyboard?.arm();
  });
  ipcMain.on('arcade:dismiss', () => {
    dismissedAtPrompt = sessions.promptCount();
    // The X means "away, now", whoever put the widget there. Clearing this is what stops
    // a hand-picked widget from springing straight back at the next hook event.
    handPicked = null;
    stopCycle();
    hold.clear();
    widgetWindow?.hide();
    syncKeyboard();
  });
  ipcMain.on('arcade:widget-done', (_e, id: string) => {
    onWidgetDone(id);
  });
  // Checked against the current widget for the same reason widget-done is: the report
  // races the swap, and a hold arriving from the board that just left would pin whatever
  // replaced it to the screen.
  ipcMain.on('arcade:widget-hold', (_e, id: string, holding: boolean) => {
    if (id !== currentWidgetId) return;
    hold.set(id, holding);
  });
  // invoke, not on: the renderer is asking for bytes back. See main/samples.ts for why
  // the renderer cannot simply fetch these itself.
  ipcMain.handle('arcade:read-sample', async (_e, name: string) => {
    const bytes = await readSample(SOUNDS_DIR, name);
    return bytes ? new Uint8Array(bytes) : null;
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
