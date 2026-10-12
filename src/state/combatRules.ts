import {
  newId,
  type AreaSave,
  type Combatant,
  type Condition,
  type Creature,
  type DamageType,
  type EffectExpiry,
  type Encounter,
} from '@/core/model';
import { formatModifier } from '@/core/rules/abilities';
import { areaDamage, type DamageResponse } from '@/core/rules/areaEffects';
import { rollDice, type DiceRoll } from '@/core/rules/dice';
import { splitXp } from '@/core/rules/difficulty';
import { creatureResources } from '@/core/rules/resources';
import { addLog, applyDamage, currentCombatant, describeRoll, nextTurn, type Rng } from './encounterActions';

/**
 * Combat upkeep used inside `useEncounterStore.getState().update(recipe)`: timed effects, turn start
 * resources, lair reminders, concentration, death saves, area saves and experience. Functions taking an
 * `Encounter` or `Combatant` mutate it, so they work on immer drafts.
 */

export type CreatureOf = (combatant: Combatant) => Creature | null;

export type EffectDuration =
  | { kind: 'none' }
  | { kind: 'rounds'; rounds: number }
  /** Until the start or end of that combatant's next turn. */
  | { kind: 'turn'; of: string; at: EffectExpiry['at'] };

/**
 * Turn boundary ending an effect applied now. Rounds count from the current turn: one round ends when the
 * current combatant's (before combat: the target's) next turn starts. A combatant's next turn is this
 * round's while it has yet to act, else the next round's.
 */
export function effectExpiry(encounter: Encounter, targetId: string, duration: EffectDuration): EffectExpiry | null {
  const round = Math.max(1, encounter.round);
  let expiry: EffectExpiry | null = null;
  switch (duration.kind) {
    case 'rounds':
      expiry = { round: round + duration.rounds, turnOf: currentCombatant(encounter)?.id ?? targetId, at: 'start' };
      break;
    case 'turn': {
      const index = encounter.combatants.findIndex((c) => c.id === duration.of);
      const later = encounter.round === 0 || index > encounter.turnIndex;
      expiry = { round: later ? round : round + 1, turnOf: duration.of, at: duration.at };
      break;
    }
    case 'none':
      break;
  }
  return expiry;
}

export function describeExpiry(encounter: Encounter, expires: EffectExpiry): string {
  const who = encounter.combatants.find((c) => c.id === expires.turnOf)?.name ?? 'a removed combatant';
  return `${expires.at} of ${who}'s turn, round ${expires.round}`;
}

export function addEffect(
  encounter: Encounter,
  combatant: Combatant,
  name: string,
  condition: Condition | null,
  expires: EffectExpiry | null,
): void {
  combatant.effects.push({ id: newId(), name, condition, expires });
  if (condition && !combatant.conditions.includes(condition)) combatant.conditions.push(condition);
  const until = expires ? ` until the ${describeExpiry(encounter, expires)}` : '';
  addLog(encounter, 'note', `${combatant.name}: ${name}${until}`);
}

/** Drops effects with their conditions unless another remaining effect imposes the same one. */
function dropEffects(combatant: Combatant, ids: readonly string[]): void {
  const dropped = combatant.effects.filter((e) => ids.includes(e.id));
  combatant.effects = combatant.effects.filter((e) => !ids.includes(e.id));
  const imposed = new Set(combatant.effects.map((e) => e.condition));
  const lifted = new Set(dropped.flatMap((e) => (e.condition && !imposed.has(e.condition) ? [e.condition] : [])));
  if (lifted.size > 0) combatant.conditions = combatant.conditions.filter((c) => !lifted.has(c));
}

export function removeEffect(encounter: Encounter, combatant: Combatant, effectId: string): void {
  const effect = combatant.effects.find((e) => e.id === effectId);
  if (effect) {
    dropEffects(combatant, [effectId]);
    addLog(encounter, 'note', `${effect.name} on ${combatant.name} removed`);
  }
}

/** Ends at its own boundary, or once its round is over when that boundary never came (combatant removed). */
function endsAt(expires: EffectExpiry, boundary: EffectExpiry): boolean {
  const same = expires.round === boundary.round && expires.turnOf === boundary.turnOf && expires.at === boundary.at;
  return same || expires.round < boundary.round;
}

/** Removes and logs every effect ending at `boundary`. */
export function expireEffects(encounter: Encounter, boundary: EffectExpiry): void {
  encounter.combatants.forEach((c) => {
    const ended = c.effects.filter((e) => e.expires && endsAt(e.expires, boundary));
    dropEffects(
      c,
      ended.map((e) => e.id),
    );
    ended.forEach((e) => addLog(encounter, 'note', `${e.name} on ${c.name} ended`));
  });
}

/** Legendary actions come back and spent recharge abilities roll their d6 at the start of the turn. */
export function startOfTurn(encounter: Encounter, combatant: Combatant, creature: Creature | null, rng?: Rng): void {
  const recharge = creature ? creatureResources(creature).recharge : [];
  if (combatant.resources.legendaryUsed > 0) combatant.resources.legendaryUsed = 0;
  recharge.forEach(({ name, min }) => {
    if (min !== null && combatant.resources.recharging.includes(name)) {
      const roll = rollDice('1d6', { rng });
      const back = roll.total >= min;
      if (back) combatant.resources.recharging = combatant.resources.recharging.filter((n) => n !== name);
      const outcome = back ? 'recharged' : `still spent (needs ${min})`;
      addLog(encounter, 'roll', `${combatant.name} · ${name} recharge: ${roll.total}, ${outcome}`);
    }
  });
}

// Lair actions happen on initiative count 20, losing ties.
const LAIR_INITIATIVE = 20;

function crossesLairCount(from: number, to: number): boolean {
  return from >= LAIR_INITIATIVE && to < LAIR_INITIATIVE;
}

/**
 * Next turn with its upkeep: effects ending with the previous turn or at the start of the new one expire,
 * a lair reminder when initiative 20 passes, then the new combatant's legendary actions and recharges.
 * Returns the names of the creatures due a lair action.
 */
export function advanceTurn(encounter: Encounter, creatureOf: CreatureOf, rng?: Rng): string[] {
  const previous = currentCombatant(encounter);
  const previousRound = encounter.round;
  nextTurn(encounter);
  const current = currentCombatant(encounter);
  if (previous) expireEffects(encounter, { round: previousRound, turnOf: previous.id, at: 'end' });
  const initiative = (c: Combatant | null, none: number) => (c ? (c.initiative ?? -Infinity) : none);
  const from = initiative(previous, Infinity);
  const to = initiative(current, -Infinity);
  // A new round passes the end of the order and then its top.
  const wrapped = previous !== null && encounter.round !== previousRound;
  const due = wrapped
    ? crossesLairCount(from, -Infinity) || crossesLairCount(Infinity, to)
    : crossesLairCount(from, to);
  const lair = due
    ? encounter.combatants.filter((c) => {
        const creature = c.hp.current > 0 ? creatureOf(c) : null;
        return creature !== null && creatureResources(creature).lair;
      })
    : [];
  const names = lair.map((c) => c.name);
  if (names.length > 0) addLog(encounter, 'note', `Lair action (initiative 20): ${names.join(', ')}`);
  if (current) {
    addLog(encounter, 'turn', `Round ${encounter.round}: ${current.name}`);
    expireEffects(encounter, { round: encounter.round, turnOf: current.id, at: 'start' });
    startOfTurn(encounter, current, creatureOf(current), rng);
  }
  return names;
}

/** 5e: DC 10 or half the damage taken, whichever is higher. */
export function concentrationDc(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}

function failDeathSave(encounter: Encounter, combatant: Combatant, count: number, why: string): void {
  const failures = Math.min(3, combatant.deathSaves.failures + count);
  combatant.deathSaves = { successes: combatant.deathSaves.successes % 3, failures };
  addLog(encounter, 'roll', `${combatant.name} ${why}: death save failure (${failures}/3)`);
  if (failures === 3) addLog(encounter, 'death', `${combatant.name} dies (3 failed death saves)`);
}

/**
 * Rule consequences of a hit point change from `before`: damage to a dying player character fails a death
 * save (and ends stability), a character back above 0 starts fresh, concentration ends at 0 HP. Returns the
 * concentration save DC the damage calls for, null when none.
 */
export function settleHpChange(
  encounter: Encounter,
  combatant: Combatant,
  before: number,
  damage: number,
): number | null {
  const { successes, failures } = combatant.deathSaves;
  if (combatant.side === 'player' && before <= 0 && damage > 0 && failures < 3) {
    failDeathSave(encounter, combatant, 1, `takes damage at 0 HP`);
  }
  if (combatant.hp.current > 0 && successes + failures > 0) combatant.deathSaves = { successes: 0, failures: 0 };
  if (combatant.concentrating && combatant.hp.current <= 0) {
    combatant.concentrating = false;
    addLog(encounter, 'note', `${combatant.name} loses concentration (0 HP)`);
  }
  return combatant.concentrating && damage > 0 ? concentrationDc(damage) : null;
}

/** Constitution save to keep concentrating; a failure ends it. Returns whether it was kept. */
export function rollConcentrationSave(
  encounter: Encounter,
  combatant: Combatant,
  dc: number,
  bonus: number,
  rng?: Rng,
): boolean {
  const roll = rollDice(`1d20${formatModifier(bonus)}`, { rng });
  const kept = roll.total >= dc;
  if (!kept) combatant.concentrating = false;
  const outcome = kept ? 'keeps concentration' : 'loses concentration';
  addLog(encounter, 'roll', `${combatant.name} concentration save DC ${dc}: ${describeRoll(roll)}, ${outcome}`);
  return kept;
}

/** PHB: 10 or higher succeeds, a natural 1 counts twice, a natural 20 brings the character back with 1 HP. */
export function rollDeathSave(encounter: Encounter, combatant: Combatant, rng?: Rng): DiceRoll {
  const roll = rollDice('1d20', { rng });
  const natural = roll.total;
  if (natural === 20) {
    combatant.hp.current = 1;
    combatant.deathSaves = { successes: 0, failures: 0 };
    addLog(encounter, 'roll', `${combatant.name} death save: natural 20, regains 1 HP`);
  } else if (natural >= 10) {
    const successes = Math.min(3, combatant.deathSaves.successes + 1);
    combatant.deathSaves.successes = successes;
    const stable = successes === 3 ? ', stable' : '';
    addLog(encounter, 'roll', `${combatant.name} death save: ${natural}, success (${successes}/3)${stable}`);
  } else {
    failDeathSave(
      encounter,
      combatant,
      natural === 1 ? 2 : 1,
      `rolls ${natural}${natural === 1 ? ' (natural 1)' : ''}`,
    );
  }
  return roll;
}

/** Spare the Dying, a Medicine check and the like. */
export function stabilize(encounter: Encounter, combatant: Combatant): void {
  combatant.deathSaves.successes = 3;
  addLog(encounter, 'note', `${combatant.name} is stable`);
}

export interface AreaTarget {
  id: string;
  /** Saving throw bonus for the area's ability. */
  bonus: number;
}

/** Rolls every target's save against the area and logs it; returns who saved, by combatant id. */
export function rollAreaSaves(
  encounter: Encounter,
  label: string,
  save: Pick<AreaSave, 'ability' | 'dc'>,
  targets: readonly AreaTarget[],
  rng?: Rng,
): Record<string, boolean> {
  return Object.fromEntries(
    targets.map(({ id, bonus }) => {
      const name = encounter.combatants.find((c) => c.id === id)?.name ?? 'combatant';
      const roll = rollDice(`1d20${formatModifier(bonus)}`, { rng });
      const saved = roll.total >= save.dc;
      const ability = save.ability.toUpperCase();
      addLog(
        encounter,
        'roll',
        `${label}: ${name} ${ability} save DC ${save.dc}: ${describeRoll(roll)}, ${saved ? 'saved' : 'failed'}`,
      );
      return [id, saved];
    }),
  );
}

export interface AreaHit {
  id: string;
  saved: boolean;
  response: DamageResponse;
}

const RESPONSE_NOTE: Record<DamageResponse, string> = {
  normal: '',
  resistant: ', resistant',
  immune: ', immune',
  vulnerable: ', vulnerable',
};

/**
 * Applies one damage roll to every target, halved or dropped on a save and adjusted for resistances.
 * Returns the concentration save DCs owed, by combatant id.
 */
export function applyAreaDamage(
  encounter: Encounter,
  label: string,
  rolled: number,
  type: DamageType,
  halfOnSuccess: boolean,
  hits: readonly AreaHit[],
): Record<string, number> {
  const owed: Record<string, number> = {};
  hits.forEach((hit) => {
    const combatant = encounter.combatants.find((c) => c.id === hit.id);
    if (combatant) {
      const amount = areaDamage(rolled, hit.saved, halfOnSuccess, hit.response);
      const before = combatant.hp.current;
      combatant.hp = applyDamage(combatant.hp, amount);
      const how = `${hit.saved ? 'saved' : 'failed'}${RESPONSE_NOTE[hit.response]}`;
      addLog(
        encounter,
        'damage',
        `${label}: ${combatant.name} takes ${amount} ${type} (${how}): ${before} → ${combatant.hp.current} HP`,
      );
      const dc = settleHpChange(encounter, combatant, before, amount);
      if (dc !== null) owed[combatant.id] = dc;
    }
  });
  return owed;
}

export interface XpAward {
  /** XP of the defeated enemies. */
  total: number;
  defeated: string[];
  /** Player characters sharing the XP. */
  characters: string[];
  share: number;
}

/** XP of enemies at 0 HP, split evenly among the player characters (remainder dropped). */
export function combatXp(encounter: Encounter, xpOf: (combatant: Combatant) => number): XpAward {
  const defeated = encounter.combatants.filter((c) => c.side === 'enemy' && c.hp.current <= 0);
  const characters = encounter.combatants.filter((c) => c.side === 'player').map((c) => c.name);
  const total = defeated.reduce((sum, c) => sum + xpOf(c), 0);
  const share = splitXp(total, characters.length);
  return { total, defeated: defeated.map((c) => c.name), characters, share };
}

export function describeXp(award: XpAward): string {
  const from = `${award.defeated.length} defeated ${award.defeated.length === 1 ? 'enemy' : 'enemies'}`;
  const split = award.characters.length > 0 ? `, ${award.share} each for ${award.characters.join(', ')}` : '';
  return `XP: ${award.total} from ${from}${split}`;
}
