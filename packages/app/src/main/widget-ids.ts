/**
 * How the main process paces and sizes the widgets it knows about.
 *
 * The ids themselves live in `@claude-arcade/shared`, because `arcade play` needs them
 * too; they are re-exported here so that everything main-side still has one import for
 * "widget ids and what to do with them". What stays here is the part only main has an
 * opinion about: which widgets end by themselves, which want the arrow keys, how big
 * their window is, and what order they come up in.
 *
 * Kept out of the renderer registry so the main process never imports renderer code
 * (which pulls in React and the DOM). Adding a widget means one entry in shared and one
 * in the renderer registry.
 */
import { GAME_IDS, TOY_IDS, WIDGET_IDS, type WidgetId } from '@claude-arcade/shared';

export { GAME_IDS, TOY_IDS, WIDGET_IDS };
export type { WidgetId };

/**
 * Widgets that decide for themselves when their turn is over.
 *
 * The fidget toys have no end state, so a clock is the only sensible way to move on. A
 * game does have one, and cutting it off mid-play at fifteen seconds is worse than not
 * showing it at all - you are left mid-rally with no idea whether you were winning.
 * They report in when they are finished and the cycle waits for that instead.
 */
const SELF_PACED = new Set<string>(GAME_IDS);

export function isSelfPaced(id: string): boolean {
  return SELF_PACED.has(id);
}

/**
 * Widgets that want arrow keys while they are on screen.
 *
 * The arrows are taken from the whole desktop for as long as one of these is up, so the
 * list is short on purpose and the bar for joining it was the same both times: arrows are
 * what the game is actually played with everywhere else, and the widget is still
 * completely playable by pointer for anyone who leaves `arrowKeys` off.
 */
export function wantsKeyboard(id: string): boolean {
  return id === 'snake' || id === 'tetris';
}

/** The longest a widget may keep the cycle waiting, however busy it says it is. */
export const HOLD_CAP_MS = 90_000;
/** How soon a deferred swap looks again. Short: the wait should end when the player does. */
export const HOLD_RECHECK_MS = 1_000;

/**
 * A widget asking the cycle clock to wait until the player has finished.
 *
 * The clock exists because a fidget toy has no ending, and that reasoning stops holding
 * the moment somebody is halfway through solving one by hand. The alternative - filing
 * such a toy as self-paced, the way a game is - would give it a game's open-ended run even
 * when nobody is watching, which is a worse trade: an unattended toy should answer to the
 * clock like every other. So a widget may ask for the swap to wait, but only while a
 * person is actually mid-something, and only for so long.
 *
 * The cap is what makes that safe. It runs from the *first* ask rather than the latest, so
 * a widget cannot renew its way into holding the screen forever, and it is checked rather
 * than scheduled - a hold that outlives its cap simply stops counting.
 */
export class CycleHold {
  private id: string | null = null;
  private since = 0;

  /** Start or end `id`'s hold. Asking again while already holding does not extend it. */
  set(id: string, holding: boolean, now: number = Date.now()): void {
    if (!holding) {
      if (this.id === id) this.clear();
      return;
    }
    if (this.id === id) return;
    this.id = id;
    this.since = now;
  }

  clear(): void {
    this.id = null;
    this.since = 0;
  }

  /** Whether the cycle has to wait rather than swap `id` out. */
  blocks(id: string, now: number = Date.now()): boolean {
    return this.id === id && now - this.since < HOLD_CAP_MS;
  }
}

/**
 * Mirrors `ArrowKey` in the renderer's widget types, for the same reason `WIDGET_IDS`
 * mirrors the registry: main must not import renderer code.
 */
export type ArrowKey = 'Up' | 'Down' | 'Left' | 'Right';

export interface WidgetBounds {
  width: number;
  height: number;
}

/** The square every toy gets unless it asks for more. */
export const WIDGET_BASE_SIZE = 280;

/**
 * Per-widget overrides for the window box.
 *
 * Newton's cradle is the one toy whose motion is far wider than it is tall: at rest it
 * fits the square, but a full swing carries the outer balls well past both edges. Rather
 * than shrink the cradle until it fits, the window grows for it.
 */
const WIDGET_OVERRIDES: Partial<Record<WidgetId, WidgetBounds>> = {
  'newtons-cradle': { width: 400, height: WIDGET_BASE_SIZE },
};

export function widgetBounds(id: string): WidgetBounds {
  return (
    WIDGET_OVERRIDES[id as WidgetId] ?? { width: WIDGET_BASE_SIZE, height: WIDGET_BASE_SIZE }
  );
}

/** The part of a display a window may occupy - Electron's `Display.workArea`. */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Breathing room between the toy and the edges of the work area. */
export const SCREEN_MARGIN = 24;

/**
 * Extra clearance above the bottom edge, and why only Windows gets any.
 *
 * An auto-hiding taskbar is not excluded from `workArea` - Windows reports the full
 * height and the bar slides out over whatever is sitting there, so the bottom-right
 * corner is the one spot on that platform where a toy can be swallowed by the OS.
 * macOS and Linux need nothing: `workArea` is already inset by the Dock, the menu bar or
 * the panel, so subtracting a Windows taskbar on top of that just parks the toy a
 * visible gap above the corner it is meant to sit in.
 */
export function bottomClearance(platform: NodeJS.Platform = process.platform): number {
  return platform === 'win32' ? 56 : 0;
}

/**
 * Where the toy sits before anybody has dragged it: the bottom-right of the work area.
 *
 * Pure, and given the work area rather than asking `screen` for it, for the same reason
 * `placeWidget` is - a platform inset below the toy is the kind of thing that is wrong on
 * somebody else's desk for months before anyone notices, and a function that can be
 * called with a fake display is a function a test can hold to account.
 */
export function defaultAnchor(
  workArea: WorkArea,
  platform: NodeJS.Platform = process.platform,
): { x: number; y: number } {
  return {
    x: workArea.x + workArea.width - WIDGET_BASE_SIZE - SCREEN_MARGIN,
    y:
      workArea.y +
      workArea.height -
      WIDGET_BASE_SIZE -
      SCREEN_MARGIN -
      bottomClearance(platform),
  };
}

/**
 * Where the window goes, given where the user parked the base square.
 *
 * A box wider than the square grows around that square's centre rather than off its left
 * edge, so a toy that needs the extra room stays visually where it was dropped. The result
 * is clamped into the work area, because the default bottom-right anchor would otherwise
 * push a wide box straight off the side of the screen.
 *
 * The work area is an argument rather than something this looks up, and that is the whole
 * reason it is a function of its own: the display it describes has to be the one nearest
 * the anchor, not the primary one. Clamping to the primary display would drag a toy parked
 * on a second monitor back onto the first at the next rotation.
 */
export function placeWidget(
  anchor: { x: number; y: number },
  bounds: WidgetBounds,
  workArea: WorkArea,
): { x: number; y: number } {
  const spread = (bounds.width - WIDGET_BASE_SIZE) / 2;
  return {
    x: Math.round(
      Math.min(
        Math.max(anchor.x - spread, workArea.x),
        workArea.x + workArea.width - bounds.width,
      ),
    ),
    y: Math.round(
      Math.min(Math.max(anchor.y, workArea.y), workArea.y + workArea.height - bounds.height),
    ),
  };
}

type Kind = 'toy' | 'game';

/**
 * Draws widgets in an alternating toy, game, toy, game order, randomly within each kind.
 *
 * Straight random picking is what you reach for first and it is wrong twice over: it
 * clusters, so three games in a row is common, and over a working day it leaves you
 * having seen one toy twice as often as another purely by luck. A shuffle bag fixes
 * both. Each kind holds a bag of its ids; drawing takes one out, and the bag is refilled
 * with a fresh shuffle only once it is empty. Every id therefore appears exactly once per
 * lap of its bag, so the counts stay level however long the session runs, while the order
 * inside a lap is still unguessable.
 *
 * Alternation splits the appearances evenly between the two kinds, which is not quite the
 * same as splitting them evenly between the widgets: the toys share one half and the games
 * share the other, so with eight games against seven toys each game comes up a shade less
 * often than each toy. That gap is accepted rather than accidental - see the test in
 * `tests/widget-ids.test.ts`, which holds the two lists to within one of each other, which
 * is where the difference stays too small to notice.
 *
 * The alternation deliberately survives the widget being hidden - it is not reset when
 * the window reappears. Restarting at a toy each time would mean short turns, which show
 * one widget and then hide, never reaching a game at all.
 */
export class WidgetRotation {
  private readonly bags: Record<Kind, string[]> = { toy: [], game: [] };
  private readonly last: Record<Kind, string | null> = { toy: null, game: null };
  /** The first draw of a session is a toy, so an appearance opens on something calm. */
  private nextKind: Kind = 'toy';

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * The id to show next.
   *
   * A pinned preference wins outright - it is a choice, not a suggestion - and leaves
   * the bags untouched, so switching back to `random` resumes where it left off.
   */
  next(preference: string): string {
    if (preference !== 'random') {
      return (WIDGET_IDS as readonly string[]).includes(preference) ? preference : WIDGET_IDS[0];
    }

    const kind = this.nextKind;
    this.nextKind = kind === 'toy' ? 'game' : 'toy';
    return this.draw(kind);
  }

  private draw(kind: Kind): string {
    const bag = this.bags[kind];
    if (bag.length === 0) bag.push(...this.refill(kind));

    const id = bag.pop()!;
    this.last[kind] = id;
    return id;
  }

  /**
   * A fresh shuffled lap, never opening on the id the previous lap closed with.
   *
   * Without that guard the seam between two laps is the one place a repeat can happen -
   * Pong finishing and Pong starting again is the sort of thing that reads as broken.
   * Reshuffling rather than swapping keeps the ordering unbiased, and it retries only
   * when the reshuffle happens to open on the same id - one time in six per kind.
   */
  private refill(kind: Kind): string[] {
    const source = kind === 'toy' ? TOY_IDS : GAME_IDS;
    const previous = this.last[kind];
    let lap: string[] = [];
    do {
      lap = this.shuffle([...source]);
      // Drawn from the end, so the last element is the one that comes out first.
    } while (source.length > 1 && lap[lap.length - 1] === previous);
    return lap;
  }

  /** Fisher-Yates: every ordering equally likely, which is the whole point here. */
  private shuffle(ids: string[]): string[] {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    return ids;
  }
}
