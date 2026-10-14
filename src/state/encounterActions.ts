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
  type Grid,
  type LogEntry,
  type Senses,
  type Settings,
  type Side,
} from '@/core/model';
import { abilityModifier, formatModifier } from '@/core/rules/abilities';
import { rollDice, type DiceRoll, type RollMode } from '@/core/rules/dice';
import { gridDistanceFt } from '@/core/rules/distance';

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

/**
 * `base NN` with a random free two-digit number (00-99), so players can't count a group from its numbers; past
 * 100 of one name the numbers continue at 100. `numberAlways` false keeps the plain name while it is free.
 */
export function uniqueName(
  base: string,
  taken: readonly string[],
  numberAlways = true,
  rng: Rng = Math.random,
): string {
  const names = new Set(taken);
  const free = Array.from({ length: 100 }, (_, n) => String(n).padStart(2, '0')).filter(
    (n) => !names.has(`${base} ${n}`),
  );
  let next = 100;
  while (free.length === 0 && names.has(`${base} ${next}`)) {
    next += 1;
  }
  const number = free.length > 0 ? free[Math.floor(rng() * free.length)]! : String(next);
  return !numberAlways && !names.has(base) ? base : `${base} ${number}`;
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
    name: uniqueName(creature.name, options.takenNames, creature.kind !== 'player', options.rng),
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
    const current = currentCombatant(encounter)?.id;
    encounter.combatants.splice(index, 1);
    const shift = index < encounter.turnIndex ? 1 : 0;
    const last = Math.max(0, encounter.combatants.length - 1);
    encounter.turnIndex = Math.min(last, encounter.turnIndex - shift);
    if (current === id) markTurnStart(encounter);
  }
}

/** Remembers where the combatant whose turn it now is stands, for "moved this turn". */
function markTurnStart(encounter: Encounter): void {
  const position = currentCombatant(encounter)?.position;
  encounter.turnStart = position ? { ...position } : null;
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
  markTurnStart(encounter);
}

/** Steps back, into the previous round when needed; never before the first turn of round 1. */
export function previousTurn(encounter: Encounter): void {
  if (encounter.turnIndex > 0) {
    encounter.turnIndex -= 1;
  } else if (encounter.round > 1) {
    encounter.round -= 1;
    encounter.turnIndex = Math.max(0, encounter.combatants.length - 1);
  }
  markTurnStart(encounter);
}

/**
 * Grid distance in feet between where the current combatant began its turn and where it stands now; null
 * outside combat or when either place is unknown.
 */
export function movedThisTurnFt(encounter: Encounter, grid: Grid, rule: Settings['diagonalRule']): number | null {
  const position = currentCombatant(encounter)?.position;
  const start = encounter.turnStart;
  return position && start ? gridDistanceFt(start, position, grid, rule) : null;
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
  roll: DiceRoll;
  /** Second roll of the dice on a critical hit; its flat bonus does not count. */
  crit: DiceRoll | null;
}

export interface AttackResult {
  toHit: DiceRoll;
  critical: boolean;
  damage: DamageResult[];
  /** Log line: the attacker's name, then `describeAttack`. */
  text: string;
}

/** A critical hit rolls the damage dice twice; flat bonuses count once. */
function rollDamage(formula: string, type: DamageType, critical: boolean, rng?: Rng): DamageResult {
  const roll = rollDice(formula, { rng });
  const crit = critical ? rollDice(formula, { rng }) : null;
  const total = roll.total + (crit ? crit.total - crit.flat : 0);
  return { type, total, roll, crit };
}

/** `1d6 [2, 5]` per dice group plus the flat bonus: `1d6 [2] + 1d4 [3] - 1`. */
function describeSum(dice: string[], flat: number): string {
  const head = dice.join(' + ');
  const tail = flat === 0 ? '' : head === '' ? String(flat) : `${flat < 0 ? ' - ' : ' + '}${Math.abs(flat)}`;
  return head + tail || '0';
}

function describeDiceGroups(roll: DiceRoll): string[] {
  return roll.terms.map((t) => `${t.count}d${t.sides} [${t.results.join(', ')}]`);
}

/** `d20 14`, with advantage or disadvantage `d20 14 (6)`: the dropped die in parentheses. */
function describeD20(toHit: DiceRoll): string {
  const results = toHit.terms[0]?.results ?? [];
  const kept = toHit.terms[0]?.kept[0] ?? 0;
  const dropped = results.length === 2 ? ` (${results[results.indexOf(kept) === 0 ? 1 : 0]})` : '';
  return `d20 ${kept}${dropped}`;
}

/**
 * Attack roll with its dice, e.g. `Scimitar: hit 17 = d20 14 + 3 · dmg 5 slashing = 1d6 [2] + 3`; a critical
 * hit reads `CRIT hit` and lists the extra dice as `crit 1d6 [4]`, a natural 1 reads `NAT 1 hit`.
 */
export function describeAttack(action: string, result: Omit<AttackResult, 'text'>): string {
  const natural = result.toHit.terms[0]?.kept[0];
  const mark = result.critical ? 'CRIT ' : natural === 1 ? 'NAT 1 ' : '';
  const hit = `${mark}hit ${result.toHit.total} = ${describeSum([describeD20(result.toHit)], result.toHit.flat)}`;
  const damage = result.damage.map((d) => {
    const crit = d.crit ? describeDiceGroups(d.crit).map((g) => `crit ${g}`) : [];
    return `${d.total} ${d.type} = ${describeSum([...describeDiceGroups(d.roll), ...crit], d.roll.flat)}`;
  });
  return `${action}: ${hit}${damage.length > 0 ? ` · dmg ${damage.join(' · ')}` : ''}`;
}

export function rollAttack(
  attacker: string,
  action: string,
  attack: AttackRoll,
  mode: RollMode,
  rng?: Rng,
): AttackResult {
  const toHit = rollDice(`1d20${formatModifier(attack.toHit)}`, { rng, mode });
  const critical = toHit.terms[0]?.kept[0] === 20;
  const damage = attack.damage.map((d) => rollDamage(d.formula, d.type, critical, rng));
  return { toHit, critical, damage, text: `${attacker} · ${describeAttack(action, { toHit, critical, damage })}` };
}
