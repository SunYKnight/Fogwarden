import {
  freshCombatState,
  newId,
  nowIso,
  type AssetRef,
  type AttackRoll,
  type Combatant,
  type Creature,
  type DamageType,
  type DocRef,
  type Encounter,
  type LogEntry,
  type Senses,
  type Side,
} from '@/core/model';
import { abilityModifier, formatModifier } from '@/core/rules/abilities';
import { rollDice, type DiceRoll, type RollMode } from '@/core/rules/dice';

/**
 * Pure encounter rules used inside `useEncounterStore.getState().update(recipe)`.
 * Functions taking an `Encounter` mutate it, so they work on immer drafts.
 */

export type HitPoints = Combatant['hp'];
export type HpMode = 'average' | 'rolled';
export type Rng = () => number;

/** Temporary hit points absorb damage first; hit points never drop below 0. */
export function applyDamage(hp: HitPoints, amount: number): HitPoints {
  const absorbed = Math.min(hp.temp, amount);
  return { ...hp, temp: hp.temp - absorbed, current: Math.max(0, hp.current - (amount - absorbed)) };
}

/** Healing never raises hit points above the maximum. */
export function applyHealing(hp: HitPoints, amount: number): HitPoints {
  return { ...hp, current: Math.max(hp.current, Math.min(hp.max, Math.max(0, hp.current) + amount)) };
}

/** 5e: temporary hit points don't stack, the higher value is kept. */
export function grantTempHp(hp: HitPoints, amount: number): HitPoints {
  return { ...hp, temp: Math.max(hp.temp, amount) };
}

/** First free `base N` (N from 1); `numberAlways` false keeps the plain name while it is free. */
export function uniqueName(base: string, taken: readonly string[], numberAlways = true): string {
  const names = new Set(taken);
  let n = 1;
  while (names.has(`${base} ${n}`)) {
    n += 1;
  }
  return !numberAlways && !names.has(base) ? base : `${base} ${n}`;
}

/** A rolled creature never starts with less than 1 hit point, even with negative Con modifiers. */
export function rollHitPoints(formula: string, rng?: Rng): number {
  return Math.max(1, rollDice(formula, { rng }).total);
}

export interface SpawnOptions {
  hpMode: HpMode;
  side: Side;
  /** Names already used in the encounter. */
  takenNames: readonly string[];
  rng?: Rng;
}

export function spawnCombatant(creature: Creature, ref: DocRef, options: SpawnOptions): Combatant {
  const { formula, average } = creature.hitPoints;
  const hp = options.hpMode === 'rolled' && formula.trim() !== '' ? rollHitPoints(formula, options.rng) : average;
  return {
    id: newId(),
    creature: ref,
    // Monsters come in groups and need telling apart; player characters don't.
    name: uniqueName(creature.name, options.takenNames, creature.kind !== 'player'),
    side: options.side,
    size: creature.size,
    armorClass: creature.armorClass,
    hp: { current: hp, max: hp, temp: 0 },
    initiative: null,
    conditions: [],
    position: null,
    facingDeg: 0,
    senses: { ...creature.senses },
    visionSource: options.side === 'player',
    hiddenFromPlayers: false,
    token: creature.token ?? creature.image,
    notes: '',
    ...freshCombatState(creature.level),
  };
}

export interface PcOptions {
  name: string;
  armorClass: number;
  maxHp: number;
  senses: Senses;
  visionSource: boolean;
  /** Character level; unknown when absent. */
  level?: number;
  /** Token picture, e.g. from the picture library. */
  token?: AssetRef | null;
}

/** Player character entered at the table without a library creature. */
export function createPc(options: PcOptions): Combatant {
  return {
    id: newId(),
    creature: null,
    name: options.name,
    side: 'player',
    size: 'medium',
    armorClass: options.armorClass,
    hp: { current: options.maxHp, max: options.maxHp, temp: 0 },
    initiative: null,
    conditions: [],
    position: null,
    facingDeg: 0,
    senses: options.senses,
    visionSource: options.visionSource,
    hiddenFromPlayers: false,
    token: options.token ?? null,
    notes: '',
    ...freshCombatState(options.level ?? null),
  };
}

export function rollInitiative(dexScore: number, rng?: Rng): DiceRoll {
  return rollDice(`1d20${formatModifier(abilityModifier(dexScore))}`, { rng });
}

/** Highest initiative first, unrolled last; ties go to the higher Dexterity, then keep their current order. */
export function orderByInitiative<C extends Combatant>(combatants: readonly C[], dexOf: (c: C) => number): C[] {
  const rank = (c: C) => c.initiative ?? -Infinity;
  return [...combatants].sort((a, b) => rank(b) - rank(a) || dexOf(b) - dexOf(a));
}

/** Combatant whose turn it is; null before the first round starts. */
export function currentCombatant(encounter: Encounter): Combatant | null {
  return encounter.round > 0 ? (encounter.combatants[encounter.turnIndex] ?? null) : null;
}

/** Applies a new combatant order while the same combatant keeps the turn. */
function reorder(encounter: Encounter, order: Combatant[]): void {
  const currentId = encounter.combatants[encounter.turnIndex]?.id;
  encounter.combatants = order;
  encounter.turnIndex = Math.max(
    0,
    order.findIndex((c) => c.id === currentId),
  );
}

export function sortByInitiative(encounter: Encounter, dexOf: (c: Combatant) => number): void {
  reorder(encounter, orderByInitiative(encounter.combatants, dexOf));
}

/** Drag-and-drop in the tracker: moves the combatant at `from` to index `to`. */
export function moveCombatant(encounter: Encounter, from: number, to: number): void {
  const order = [...encounter.combatants];
  const [moved] = order.splice(from, 1);
  if (moved) {
    order.splice(to, 0, moved);
    reorder(encounter, order);
  }
}

/** The next combatant in order takes over when the current one is removed. */
export function removeCombatant(encounter: Encounter, id: string): void {
  const index = encounter.combatants.findIndex((c) => c.id === id);
  if (index >= 0) {
    encounter.combatants.splice(index, 1);
    const shift = index < encounter.turnIndex ? 1 : 0;
    const last = Math.max(0, encounter.combatants.length - 1);
    encounter.turnIndex = Math.min(last, encounter.turnIndex - shift);
  }
}

/** Starts round 1 on the first call; wraps to the top of the order with a new round. */
export function nextTurn(encounter: Encounter): void {
  const count = encounter.combatants.length;
  if (count > 0 && encounter.round === 0) {
    encounter.round = 1;
    encounter.turnIndex = 0;
  } else if (count > 0 && encounter.turnIndex + 1 >= count) {
    encounter.round += 1;
    encounter.turnIndex = 0;
  } else if (count > 0) {
    encounter.turnIndex += 1;
  }
}

/** Steps back, into the previous round when needed; never before the first turn of round 1. */
export function previousTurn(encounter: Encounter): void {
  if (encounter.turnIndex > 0) {
    encounter.turnIndex -= 1;
  } else if (encounter.round > 1) {
    encounter.round -= 1;
    encounter.turnIndex = Math.max(0, encounter.combatants.length - 1);
  }
}

export function addLog(encounter: Encounter, kind: LogEntry['kind'], text: string): void {
  encounter.log.push({ id: newId(), at: nowIso(), kind, text });
}

export function describeRoll(roll: DiceRoll): string {
  return `${roll.total} (${roll.detail})`;
}

export interface DamageResult {
  type: DamageType;
  total: number;
  text: string;
}

export interface AttackResult {
  toHit: DiceRoll;
  critical: boolean;
  damage: DamageResult[];
  /** Log line, e.g. `Goblin 1 · Scimitar: 17 to hit (…); 5 slashing (…)`. */
  text: string;
}

/** A critical hit rolls the damage dice twice; flat bonuses count once. */
function rollDamage(formula: string, type: DamageType, critical: boolean, rng?: Rng): DamageResult {
  const roll = rollDice(formula, { rng });
  const extra = critical ? rollDice(formula, { rng }) : null;
  const total = roll.total + (extra ? extra.total - extra.flat : 0);
  const detail = extra ? `${roll.detail}; crit dice ${extra.detail}` : roll.detail;
  return { type, total, text: `${total} ${type} (${detail})` };
}

export function rollAttack(
  attacker: string,
  action: string,
  attack: AttackRoll,
  mode: RollMode,
  rng?: Rng,
): AttackResult {
  const toHit = rollDice(`1d20${formatModifier(attack.toHit)}`, { rng, mode });
  const natural = toHit.terms[0]?.kept[0];
  const critical = natural === 20;
  const damage = attack.damage.map((d) => rollDamage(d.formula, d.type, critical, rng));
  const hitText = `${toHit.total} to hit (${toHit.detail})${critical ? ' CRITICAL' : natural === 1 ? ' miss (1)' : ''}`;
  const damageText = damage.map((d) => d.text).join(' + ');
  return { toHit, critical, damage, text: `${attacker} · ${action}: ${hitText}${damageText ? `; ${damageText}` : ''}` };
}
