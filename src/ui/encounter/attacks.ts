import type { Creature, CreatureAction } from '@/core/model';
import { formatModifier } from '@/core/rules/abilities';

/** Actions and bonus actions with an attack roll, the ones a button can roll in one click. */
export function attackActions(creature: Creature | null): CreatureAction[] {
  return [...(creature?.actions ?? []), ...(creature?.bonusActions ?? [])].filter((a) => a.attack);
}

export function attackLabel(action: CreatureAction): string {
  const damage = action.attack?.damage.map((d) => d.formula).join(' + ') ?? '';
  return `${action.name} ${formatModifier(action.attack?.toHit ?? 0)}${damage ? ` · ${damage}` : ''}`;
}
