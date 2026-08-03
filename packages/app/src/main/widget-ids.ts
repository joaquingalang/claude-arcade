/**
 * Widget ids known to the main process.
 *
 * Kept separate from the renderer registry so the main process never imports renderer
 * code (which pulls in React and the DOM). Adding a widget means one entry here and one
 * in the renderer registry.
 */
/** The fidget toys: no end state, so the clock moves them along. */
export const TOY_IDS = ['bubble-wrap', 'fidget-spinner', 'newtons-cradle'] as const;

/** The games: they run to their own ending and report in when they get there. */
export const GAME_IDS = ['snake', 'flappy-bird', 'pong'] as const;

export const WIDGET_IDS = [...TOY_IDS, ...GAME_IDS] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

/**
 * Widgets that decide for themselves when their turn is over.
 *
 * The fidget toys have no end state, so a clock is the only sensible way to move on. A
 * game does have one, and cutting it off mid-play at fifteen seconds is worse than not
 * showing it at all - you are left mid-rally with no idea whether you were winning.
 * These three report in when they are finished and the cycle waits for that instead.
 */
const SELF_PACED = new Set<string>(GAME_IDS);

export function isSelfPaced(id: string): boolean {
  return SELF_PACED.has(id);
}

/** Widgets that want arrow keys while they are on screen. */
export function wantsKeyboard(id: string): boolean {
  return id === 'snake';
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
 * Alternation is what keeps the two kinds level with each other: with three of each, one
 * toy then one game means every one of the six comes up a sixth of the time.
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
   * Reshuffling rather than swapping keeps the ordering unbiased, and with three ids per
   * kind it retries at most a couple of times.
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
