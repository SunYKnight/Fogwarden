import type { Creature, CreatureAction } from '@/core/model';
import { formatModifier } from '@/core/rules/abilities';
import type { AttackResult } from '@/state/encounterActions';

/** Actions and bonus actions with an attack roll, the ones a button can roll in one click. */
export function attackActions(creature: Creature | null): CreatureAction[] {
  return [...(creature?.actions ?? []), ...(creature?.bonusActions ?? [])].filter((a) => a.attack);
}

export function attackLabel(action: CreatureAction): string {
  const damage = action.attack?.damage.map((d) => d.formula).join(' + ') ?? '';
  return `${action.name} ${formatModifier(action.attack?.toHit ?? 0)}${damage ? ` · ${damage}` : ''}`;
}

/** Short inline form of the log line: "17 to hit · 5 slashing". */
export function resultSummary(result: AttackResult): string {
  const natural = result.toHit.terms[0]?.kept[0];
  const mark = result.critical ? ' CRITICAL' : natural === 1 ? ' (natural 1)' : '';
  const damage = result.damage.map((d) => `${d.total} ${d.type}`).join(' + ');
  return `${result.toHit.total} to hit${mark}${damage ? ` · ${damage}` : ''}`;
}
