import type { Creature, CreatureAction } from '@/core/model';
import { formatModifier } from '@/core/rules/abilities';
import type { AttackResult } from '@/state/encounterActions';

export type AttackOutcome = 'critical' | 'hit' | 'miss' | 'fumble';

/** A natural 20 always hits, a natural 1 always misses; otherwise the total has to reach the armor class. */
export function attackOutcome(result: AttackResult, armorClass: number): AttackOutcome {
  const natural = result.toHit.terms[0]?.kept[0];
  let outcome: AttackOutcome = result.toHit.total >= armorClass ? 'hit' : 'miss';
  if (natural === 20) {
    outcome = 'critical';
  } else if (natural === 1) {
    outcome = 'fumble';
  }
  return outcome;
}

/** Actions and bonus actions with an attack roll, the ones a button can roll in one click. */
export function attackActions(creature: Creature | null): CreatureAction[] {
  return [...(creature?.actions ?? []), ...(creature?.bonusActions ?? [])].filter((a) => a.attack);
}

export function attackLabel(action: CreatureAction): string {
  const damage = action.attack?.damage.map((d) => d.formula).join(' + ') ?? '';
  return `${action.name} ${formatModifier(action.attack?.toHit ?? 0)}${damage ? ` · ${damage}` : ''}`;
}
