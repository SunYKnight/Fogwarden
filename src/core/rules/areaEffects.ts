import type { Ability, Combatant, Creature, DamageType, Grid } from '../model';
import { abilityModifier } from './abilities';
import { footprintCells } from './space';
import { areaCells, type PlacedArea } from './templates';

/**
 * Placed combatants with at least one footprint square inside the area (DMG grid rule), whatever they or the
 * players can see.
 */
export function combatantsInArea<C extends Pick<Combatant, 'position' | 'size'>>(
  area: PlacedArea,
  grid: Grid,
  combatants: readonly C[],
): C[] {
  const inside = new Set(areaCells(area, grid).map((c) => `${c.col},${c.row}`));
  return combatants.filter(
    (c) => c.position && footprintCells(c.position, c.size, grid).some((f) => inside.has(`${f.col},${f.row}`)),
  );
}

/** Proficient saves from the stat block, else the ability modifier; ad-hoc combatants roll flat. */
export function saveBonus(creature: Creature | null, ability: Ability): number {
  return creature ? (creature.savingThrows[ability] ?? abilityModifier(creature.abilities[ability])) : 0;
}

export type DamageResponse = 'normal' | 'resistant' | 'immune' | 'vulnerable';

/**
 * How a creature takes damage of `type`. Only plain entries count: qualified ones such as "bludgeoning, piercing,
 * and slashing from nonmagical weapons" cover weapon attacks, never area effects.
 */
export function damageResponse(creature: Creature | null, type: DamageType): DamageResponse {
  const has = (list: readonly string[]) => list.includes(type);
  return !creature
    ? 'normal'
    : has(creature.damageImmunities)
      ? 'immune'
      : has(creature.damageResistances)
        ? 'resistant'
        : has(creature.damageVulnerabilities)
          ? 'vulnerable'
          : 'normal';
}

const RESPONSE_FACTOR: Record<DamageResponse, number> = { normal: 1, resistant: 0.5, immune: 0, vulnerable: 2 };

/** Damage a target takes from a rolled area: halved or nothing on a save, then resistances (PHB order). */
export function areaDamage(rolled: number, saved: boolean, halfOnSuccess: boolean, response: DamageResponse): number {
  const afterSave = saved ? (halfOnSuccess ? Math.floor(rolled / 2) : 0) : rolled;
  return Math.floor(afterSave * RESPONSE_FACTOR[response]);
}
