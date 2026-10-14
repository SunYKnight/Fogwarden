import { FileFormatError, formatFrontMatter, parseFrontMatter, readTimestamp } from './frontMatter';
import { DiceError, parseDice, rollDice } from './rules/dice';

/**
 * Random tables are plain text files (`tables/<id>.txt`): an optional header (`name`, `dice`, `createdAt`,
 * `updatedAt`), then one entry per line. `3: text` weighs an entry 3 (plain lines weigh 1); `1-3: text` and
 * `4: text` are dice ranges. A table is a dice table when it has a `dice` header, any range, or numbers 1, 2, 3 …
 * on every line; `00` stands for 100. Lines starting with `#` are comments. `[name]` in an entry rolls on the
 * table with that name or id, `[2d6]` rolls dice.
 */

const HEADER_KEYS = ['name', 'dice', 'createdAt', 'updatedAt'] as const;
const RANGE_LINE = /^(\d+)\s*[-–]\s*(\d+)\s*:\s*(.+)$/;
const NUMBER_LINE = /^(\d+)\s*:\s*(.+)$/;
const REFERENCE = /\[([^[\]]+)\]/g;
const DICE_TEXT = /^[\d\s+dD-]+$/;
/** Deeper nesting means tables that refer to each other in a loop. */
const MAX_DEPTH = 8;

export interface TableEntry {
  text: string;
  /** Inclusive dice range in a dice table; weight 1 there. */
  from: number;
  to: number;
  weight: number;
}

export interface RandomTable {
  id: string;
  name: string;
  /** Null when the file has no time stamps (hand-written). */
  createdAt: string | null;
  updatedAt: string | null;
  /** `dice` header (e.g. `2d6`); dice tables without it roll `1d<highest>`. */
  dice: string | null;
  kind: 'dice' | 'weights';
  entries: TableEntry[];
  /** The entry lines as written, comments included; what the editor shows and the file keeps. */
  text: string;
}

export interface TableRoll {
  tableName: string;
  text: string;
  /** How the entry was picked, e.g. `d100: 37` or `5 of 12`. */
  detail: string;
}

export interface RollContext {
  /** Table by id or name (case-insensitive) for `[name]` references. */
  find: (ref: string) => RandomTable | undefined;
  rng?: () => number;
}

interface ParsedLine {
  line: number;
  text: string;
  from: number | null;
  to: number | null;
}

/** `tavern-names` → `Tavern names`, for files without a `name` header. */
function nameFromId(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function rangeNumber(digits: string): number {
  return digits === '00' ? 100 : Number(digits);
}

function parseLine(raw: string, line: number): ParsedLine {
  const range = RANGE_LINE.exec(raw);
  const single = range ? null : NUMBER_LINE.exec(raw);
  const result: ParsedLine = { line, text: raw, from: null, to: null };
  if (range) {
    Object.assign(result, { from: rangeNumber(range[1]!), to: rangeNumber(range[2]!), text: range[3]!.trim() });
  } else if (single) {
    const value = rangeNumber(single[1]!);
    Object.assign(result, { from: value, to: value, text: single[2]!.trim() });
  }
  return result;
}

function diceBounds(dice: string): { min: number; max: number } {
  const parsed = parseDice(dice);
  const count = parsed.terms.reduce((sum, t) => sum + t.count, 0);
  const max = parsed.terms.reduce((sum, t) => sum + t.count * t.sides, 0);
  return { min: count + parsed.flat, max: max + parsed.flat };
}

function diceEntries(lines: ParsedLine[], dice: string | null, diceLine: number): TableEntry[] {
  lines.forEach((l, i) => {
    const previous = lines[i - 1];
    if (l.from === null || l.to === null) {
      throw new FileFormatError('Every line of a dice table needs a number or range like "4-6: text"', l.line);
    }
    if (l.from > l.to) {
      throw new FileFormatError(`Range ${l.from}-${l.to} runs backwards`, l.line);
    }
    if (previous && l.from !== previous.to! + 1) {
      throw new FileFormatError(`Expected the range to start at ${previous.to! + 1}`, l.line);
    }
  });
  const lowest = lines[0]?.from ?? 1;
  const highest = lines[lines.length - 1]?.to ?? 1;
  const bounds = dice === null ? null : diceBounds(dice);
  if (bounds === null && lowest !== 1) {
    throw new FileFormatError(`Ranges start at ${lowest}; add a header line such as "dice: 2d6"`, lines[0]!.line);
  }
  if (bounds && lines.length > 0 && (bounds.min !== lowest || bounds.max !== highest)) {
    const message = `${dice} rolls ${bounds.min}-${bounds.max}, the ranges cover ${lowest}-${highest}`;
    throw new FileFormatError(message, diceLine);
  }
  return lines.map((l) => ({ text: l.text, from: l.from!, to: l.to!, weight: 1 }));
}

function weightEntries(lines: ParsedLine[]): TableEntry[] {
  return lines.map((l) => {
    const weight = l.from ?? 1;
    if (weight < 1) {
      throw new FileFormatError('Weights start at 1', l.line);
    }
    return { text: l.text, from: 0, to: 0, weight };
  });
}

export function parseTableFile(text: string, id: string): RandomTable {
  const header = parseFrontMatter(text, HEADER_KEYS);
  const dice = header.values.dice || null;
  const diceLine = header.lines.dice ?? 1;
  if (dice !== null) {
    let reason: string;
    try {
      reason = parseDice(dice).terms.length === 0 ? 'no dice' : '';
    } catch (error) {
      if (!(error instanceof DiceError)) {
        throw error;
      }
      reason = error.message;
    }
    if (reason !== '') {
      throw new FileFormatError(`"dice" must be dice like 1d100 or 2d6 (${reason})`, diceLine);
    }
  }
  const lines = header.body
    .split('\n')
    .map((raw, i) => ({ raw: raw.trim(), line: header.bodyLine + i }))
    .filter(({ raw }) => raw !== '' && !raw.startsWith('#'))
    .map(({ raw, line }) => parseLine(raw, line));
  const counted = lines.length > 0 && lines.every((l, i) => l.from === i + 1 && l.to === i + 1);
  const isDice = dice !== null || counted || lines.some((l) => l.from !== l.to);
  return {
    id,
    name: header.values.name || nameFromId(id),
    createdAt: readTimestamp(header, 'createdAt'),
    updatedAt: readTimestamp(header, 'updatedAt'),
    dice,
    kind: isDice ? 'dice' : 'weights',
    entries: isDice ? diceEntries(lines, dice, diceLine) : weightEntries(lines),
    text: header.body,
  };
}

export function formatTableFile(table: RandomTable): string {
  const header: [string, string][] = [
    ['name', table.name],
    ['dice', table.dice ?? ''],
    ['createdAt', table.createdAt ?? ''],
    ['updatedAt', table.updatedAt ?? ''],
  ];
  return formatFrontMatter(header, table.text);
}

export function createRandomTable(id: string, name: string, at: string): RandomTable {
  return { id, name, createdAt: at, updatedAt: at, dice: null, kind: 'weights', entries: [], text: '' };
}

function pickEntry(table: RandomTable, rng: () => number): { entry: TableEntry; detail: string } {
  let picked: { entry: TableEntry; detail: string };
  if (table.kind === 'dice') {
    const dice = table.dice ?? `1d${table.entries[table.entries.length - 1]!.to}`;
    const total = rollDice(dice, { rng }).total;
    const entry = table.entries.find((e) => e.from <= total && total <= e.to)!;
    picked = { entry, detail: `${parseDice(dice).expression}: ${total}` };
  } else {
    const sum = table.entries.reduce((s, e) => s + e.weight, 0);
    const roll = 1 + Math.floor(rng() * sum);
    let left = roll;
    const entry = table.entries.find((e) => (left -= e.weight) <= 0)!;
    picked = { entry, detail: `${roll} of ${sum}` };
  }
  return picked;
}

/** Picks an entry and fills its `[table]` and `[dice]` references; errors name the table. */
export function rollOnTable(table: RandomTable, context: RollContext, depth = 0): TableRoll {
  if (depth > MAX_DEPTH) {
    throw new Error(`Tables nest deeper than ${MAX_DEPTH} levels at "${table.name}"; do they refer to each other?`);
  }
  if (table.entries.length === 0) {
    throw new Error(`Table "${table.name}" has no entries`);
  }
  const rng = context.rng ?? Math.random;
  const { entry, detail } = pickEntry(table, rng);
  const text = entry.text.replace(REFERENCE, (_whole, inner: string) => {
    const ref = inner.trim();
    const nested = DICE_TEXT.test(ref) ? null : context.find(ref);
    if (!DICE_TEXT.test(ref) && nested === undefined) {
      throw new Error(`Table "${table.name}" refers to [${ref}], but no table has that name`);
    }
    return nested ? rollOnTable(nested, context, depth + 1).text : String(rollDice(ref, { rng }).total);
  });
  return { tableName: table.name, text, detail };
}

/** Finds a table by id or by name, ignoring case, as `[name]` references do. */
export function findTable(tables: readonly RandomTable[], ref: string): RandomTable | undefined {
  const lower = ref.toLowerCase();
  return tables.find((t) => t.id.toLowerCase() === lower) ?? tables.find((t) => t.name.toLowerCase() === lower);
}
