export interface Searchable {
  label: string;
  /** Kind of entry such as "Go to" or "Creature"; searched like a keyword. */
  group: string;
  keywords: readonly string[];
}

const WORD_SEPARATOR = /[\s\-_/().,:›]+/;
const PREFIX = 300;
const WORD_PREFIX = 200;
const SUBSTRING = 100;
// Scattered letters rank below any substring hit, so the scale ends below it.
const SCATTERED_MAX = 99;

/** How well the letters of `token` appear in `text`, in order; higher is better, null when they don't. */
export function matchScore(text: string, token: string): number | null {
  const lower = text.toLowerCase();
  const at = lower.indexOf(token);
  let score: number | null;
  if (at === 0) {
    score = PREFIX;
  } else if (lower.split(WORD_SEPARATOR).some((word) => word.startsWith(token))) {
    score = WORD_PREFIX;
  } else if (at > 0) {
    score = SUBSTRING;
  } else {
    score = scatteredScore(lower, token);
  }
  return score;
}

/** Letters that start a word or follow the previous hit count double. */
function scatteredScore(lower: string, token: string): number | null {
  let from = 0;
  let points = 0;
  let missing = false;
  for (const char of token) {
    const at: number = missing ? -1 : lower.indexOf(char, from);
    const wordStart = at === 0 || (at > 0 && WORD_SEPARATOR.test(lower[at - 1]!));
    missing = at < 0;
    points += wordStart || (at > 0 && at === from) ? 2 : 1;
    from = at + 1;
  }
  return missing ? null : Math.round((SCATTERED_MAX * points) / (2 * token.length));
}

interface EntryScore {
  score: number;
  /** Every word appears as a whole piece somewhere, not only as scattered letters. */
  exact: boolean;
}

function entryScore(entry: Searchable, tokens: string[]): EntryScore | null {
  let total: EntryScore | null = { score: 0, exact: true };
  for (const token of tokens) {
    const label = matchScore(entry.label, token) ?? 0;
    const extras = Math.max(0, ...[entry.group, ...entry.keywords].map((k) => matchScore(k, token) ?? 0));
    // A hit in a keyword counts half: the label is what the user reads.
    const best = Math.max(label, extras / 2);
    const exact = Math.max(label, extras) >= SUBSTRING;
    total = total === null || best === 0 ? null : { score: total.score + best, exact: total.exact && exact };
  }
  return total;
}

/**
 * Entries whose label, group or keywords contain every word of `query`, best first; ties keep the shorter label,
 * then the given order. Scattered-letter matches only show when nothing contains the words as typed ("rain"
 * would otherwise list every "Red Dragon Wyrmling"). An empty query keeps all entries in order.
 */
export function rankCommands<T extends Searchable>(entries: readonly T[], query: string): T[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const hits = entries
    .map((entry, index) => ({ entry, index, match: entryScore(entry, tokens) }))
    .filter((hit): hit is { entry: T; index: number; match: EntryScore } => hit.match !== null);
  const exactOnly = hits.some((hit) => hit.match.exact);
  return tokens.length === 0
    ? [...entries]
    : hits
        .filter((hit) => !exactOnly || hit.match.exact)
        .sort(
          (a, b) => b.match.score - a.match.score || a.entry.label.length - b.entry.label.length || a.index - b.index,
        )
        .map((hit) => hit.entry);
}
