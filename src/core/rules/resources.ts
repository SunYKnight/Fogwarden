import type { Creature } from '../model';

/** Ability that comes back on a d6 roll of `min` or more at the start of the creature's turn. */
export interface RechargeAbility {
  /** Name without the "(Recharge 5-6)" part; key of `CombatResources.recharging`. */
  name: string;
  /** Null for abilities that only come back after a rest. */
  min: number | null;
}

/** Feature or innate spell usable `max` times a day; `name` keys `CombatResources.dailyUsed`. */
export interface DailyUse {
  name: string;
  max: number;
}

/** Limited resources a stat block carries. */
export interface CreatureResources {
  legendary: number;
  recharge: RechargeAbility[];
  /** Spell slots by slot level ("1" to "9"). */
  slots: Record<string, number>;
  daily: DailyUse[];
  /** Legendary creatures and stat blocks mentioning lair actions act on initiative 20. */
  lair: boolean;
}

// MM default when the intro text does not state the number.
const DEFAULT_LEGENDARY_ACTIONS = 3;
const RECHARGE = /\s*\(Recharges? (?:(\d)(?:\s*[-–]\s*\d)?|after a [^)]*)\)/i;
const PER_DAY = /\s*\((\d+)\/Day\)/i;
const SLOTS = /(\d)(?:st|nd|rd|th) level \((\d+) slots?\)/gi;
// Every heading of a spell list; a list runs until the next one.
const SPELL_HEADING = /(?:Cantrips \([^)]*\)|\d(?:st|nd|rd|th) level \([^)]*\)|At will|(\d+)\/day( each)?):/gi;

/** Comma-separated spells without notes in parentheses or asterisks. */
function spellNames(list: string): string[] {
  return list
    .replace(/\([^)]*\)/g, '')
    .split(',')
    .map((s) => s.replace(/\*/g, '').trim())
    .filter((s) => s !== '');
}

/** "3/day each: a, b" gives every spell three uses; "3/day: a, b" shares three uses between them. */
function innateUses(text: string): DailyUse[] {
  const headings = [...text.matchAll(SPELL_HEADING)];
  return headings.flatMap((h, i) => {
    const end = headings[i + 1]?.index ?? text.length;
    const spells = spellNames(text.slice(h.index + h[0].length, end));
    const max = h[1] === undefined ? 0 : Number(h[1]);
    const uses = h[2] ? spells.map((name) => ({ name, max })) : [{ name: spells.join(', '), max }];
    return max > 0 && spells.length > 0 ? uses : [];
  });
}

export function creatureResources(creature: Creature): CreatureResources {
  const features = [...creature.traits, ...creature.actions, ...creature.bonusActions, ...creature.reactions];
  const legendaryCount = /can take (\d+) legendary actions/i.exec(creature.legendaryDescription)?.[1];
  const recharge = features.flatMap((f) => {
    const match = RECHARGE.exec(f.name);
    return match ? [{ name: f.name.replace(RECHARGE, '').trim(), min: match[1] ? Number(match[1]) : null }] : [];
  });
  const perDay = features.flatMap((f) => {
    const match = PER_DAY.exec(f.name);
    return match ? [{ name: f.name.replace(PER_DAY, '').trim(), max: Number(match[1]) }] : [];
  });
  const spellcasting = creature.traits.filter((t) => /spellcasting/i.test(t.name));
  const slots = Object.fromEntries(
    spellcasting.flatMap((t) => [...t.description.matchAll(SLOTS)].map((m) => [m[1]!, Number(m[2])])),
  );
  const innate = spellcasting.flatMap((t) => innateUses(t.description));
  const texts = [creature.legendaryDescription, ...features.map((f) => `${f.name} ${f.description}`)];
  return {
    legendary: creature.legendaryActions.length > 0 ? Number(legendaryCount ?? DEFAULT_LEGENDARY_ACTIONS) : 0,
    recharge,
    slots,
    daily: [...perDay, ...innate],
    lair: creature.legendaryActions.length > 0 || texts.some((t) => /lair action/i.test(t)),
  };
}
