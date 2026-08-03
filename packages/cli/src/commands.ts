import { WIDGET_IDS } from '@claude-arcade/shared';

/**
 * What `arcade` was asked to do.
 *
 * Everything the wrapper doesn't recognise is a `claude` command line, not an error -
 * that is the whole shape of this CLI. Only a bare first word is ever claimed as our own,
 * so `arcade -p "fix the tests"` keeps going straight through, and `arcade --no-widget
 * doctor` still reaches `claude doctor` if that is what you meant.
 */
export type Command =
  | { kind: 'help' }
  | { kind: 'doctor' }
  | { kind: 'list' }
  /** `name` is null when `play` was typed with nothing after it. */
  | { kind: 'play'; name: string | null }
  | { kind: 'stop' }
  | { kind: 'claude'; args: string[]; withWidget: boolean };

export function parseCommand(argv: string[]): Command {
  const [first, ...rest] = argv;

  switch (first) {
    case '--help':
    case '-h':
      return { kind: 'help' };
    case 'doctor':
      return { kind: 'doctor' };
    case 'list':
      return { kind: 'list' };
    case 'play':
      return { kind: 'play', name: rest[0] ?? null };
    case 'stop':
      return { kind: 'stop' };
    case '--no-widget':
      return { kind: 'claude', args: rest, withWidget: false };
    default:
      return { kind: 'claude', args: argv, withWidget: true };
  }
}

/**
 * One widget id, or the reason there isn't one.
 *
 * `candidates` is only populated when the input matched more than one id; an input that
 * matched nothing has nothing useful to suggest and gets the full list instead.
 */
export type WidgetMatch = { found: string } | { found: null; candidates: string[] };

/** Ids are lowercase and hyphenated; nobody should have to remember which. */
const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Turn what someone typed into a widget id.
 *
 * Exact first, then prefix, then substring, and each step only counts if it lands on
 * exactly one id. `space_invaders`, `Space Invaders` and `invaders` all reach the same
 * widget; `s` reaches four and so reaches none of them, because guessing between Snake,
 * Simon, Suika and Space Invaders is worse than saying which four it could be.
 */
export function resolveWidgetId(
  input: string,
  ids: readonly string[] = WIDGET_IDS,
): WidgetMatch {
  const wanted = normalize(input);
  if (!wanted) return { found: null, candidates: [] };

  const exact = ids.filter((id) => normalize(id) === wanted);
  if (exact.length === 1) return { found: exact[0]! };

  const prefix = ids.filter((id) => normalize(id).startsWith(wanted));
  if (prefix.length === 1) return { found: prefix[0]! };

  const contains = ids.filter((id) => normalize(id).includes(wanted));
  if (contains.length === 1) return { found: contains[0]! };

  return { found: null, candidates: prefix.length > 0 ? prefix : contains };
}
