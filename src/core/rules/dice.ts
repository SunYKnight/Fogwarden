/** One `NdS` group of an expression; `count` dice with `sides` faces each. */
export interface DiceTerm {
  count: number;
  sides: number;
}

export interface DiceExpression {
  /** Normalised expression without whitespace, e.g. `2d6+1d4+3`. */
  expression: string;
  terms: DiceTerm[];
  flat: number;
}

export interface DiceRoll {
  expression: string;
  total: number;
  terms: { count: number; sides: number; results: number[]; kept: number[] }[];
  flat: number;
  /** Human readable breakdown, e.g. `1d20 [17, (4)] + 3 = 20`; dropped dice in parentheses. */
  detail: string;
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export class DiceError extends Error {
  constructor(
    message: string,
    readonly expression: string,
  ) {
    super(`${message}: "${expression}"`);
    this.name = 'DiceError';
  }
}

const MAX_DICE = 1000;
const MAX_SIDES = 1000;
const EXPRESSION = /^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/i;
const TOKEN = /([+-]?)(?:(\d*)d(\d+)|(\d+))/gi;

export function parseDice(expr: string): DiceExpression {
  const compact = expr.replace(/\s+/g, '').toLowerCase();
  if (!EXPRESSION.test(compact)) {
    throw new DiceError('Invalid dice expression', expr);
  }
  const terms: DiceTerm[] = [];
  let flat = 0;
  for (const match of compact.matchAll(TOKEN)) {
    const sign = match[1] === '-' ? -1 : 1;
    if (match[4] !== undefined) {
      flat += sign * Number(match[4]);
    } else {
      const count = match[2] === '' ? 1 : Number(match[2]);
      const sides = Number(match[3]);
      if (sign < 0) {
        throw new DiceError('Subtracting dice is not supported', expr);
      }
      if (count < 1 || count > MAX_DICE || sides < 1 || sides > MAX_SIDES) {
        throw new DiceError(`Dice count must be 1-${MAX_DICE} and sides 1-${MAX_SIDES}`, expr);
      }
      terms.push({ count, sides });
    }
  }
  return { expression: formatDice(terms, flat), terms, flat };
}

function formatDice(terms: DiceTerm[], flat: number): string {
  const dice = terms.map((t) => `${t.count}d${t.sides}`).join('+');
  const bonus = flat === 0 ? '' : `${flat > 0 && dice !== '' ? '+' : ''}${flat}`;
  return dice === '' && flat === 0 ? '0' : dice + bonus;
}

/** Rolls an expression; advantage/disadvantage rolls its first `1d20` term twice and keeps one. */
export function rollDice(expr: string, options: { rng?: () => number; mode?: RollMode } = {}): DiceRoll {
  const parsed = parseDice(expr);
  const rng = options.rng ?? Math.random;
  const mode = options.mode ?? 'normal';
  const d20 = parsed.terms.findIndex((t) => t.count === 1 && t.sides === 20);
  if (mode !== 'normal' && d20 === -1) {
    throw new DiceError(`${mode} needs a single d20 term`, expr);
  }
  const terms = parsed.terms.map((term, i) => {
    const twice = mode !== 'normal' && i === d20;
    const results = Array.from({ length: twice ? 2 : term.count }, () =>
      Math.min(term.sides, 1 + Math.floor(rng() * term.sides)),
    );
    const pick = mode === 'advantage' ? Math.max(...results) : Math.min(...results);
    return { ...term, results, kept: twice ? [pick] : results };
  });
  const total = terms.reduce((sum, t) => sum + t.kept.reduce((a, b) => a + b, 0), parsed.flat);
  const dice = terms.map((t) => `${t.count}d${t.sides} [${describeResults(t.results, t.kept)}]`).join(' + ');
  const sign = parsed.flat < 0 ? '-' : '+';
  const flat = parsed.flat === 0 ? '' : dice === '' ? String(parsed.flat) : ` ${sign} ${Math.abs(parsed.flat)}`;
  return { expression: parsed.expression, total, terms, flat: parsed.flat, detail: `${dice}${flat} = ${total}` };
}

function describeResults(results: number[], kept: number[]): string {
  const dropIndex = kept.length === results.length ? -1 : results.indexOf(kept[0]!) === 0 ? 1 : 0;
  return results.map((r, i) => (i === dropIndex ? `(${r})` : String(r))).join(', ');
}

/** 5e average: expected value of every term, rounded down once at the end. */
export function averageDice(expr: string): number {
  const parsed = parseDice(expr);
  const dice = parsed.terms.reduce((sum, t) => sum + (t.count * (t.sides + 1)) / 2, 0);
  return Math.floor(dice + parsed.flat);
}
