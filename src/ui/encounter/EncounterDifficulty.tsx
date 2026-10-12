import type { Combatant } from '@/core/model';
import { encounterDifficulty, type Difficulty } from '@/core/rules/difficulty';
import { useLibraryStore } from '@/state/libraryStore';

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  trivial: 'Trivial',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  deadly: 'Deadly',
};

const xp = (n: number) => n.toLocaleString('en-US');

/**
 * DMG difficulty of the enemies (plus `extraXp`, monsters about to be added) for the player characters,
 * with the numbers in the tooltip; asks for the levels it still needs.
 */
export function DifficultyBadge({
  combatants,
  extraXp = [],
}: {
  combatants: readonly Combatant[];
  extraXp?: number[];
}) {
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const party = combatants.filter((c) => c.side === 'player');
  const unknown = party.filter((c) => c.level === null).map((c) => c.name);
  const monsterXp = combatants
    .filter((c) => c.side === 'enemy')
    .map((c) => entries.find((e) => e.ref.id === c.creature?.id)?.doc.xp ?? 0)
    .concat(extraXp);
  const report = encounterDifficulty(
    party.flatMap((c) => (c.level === null ? [] : [c.level])),
    monsterXp,
  );
  let label = 'Difficulty: no party';
  let title = 'Add player characters with a level to rate the encounter.';
  let tone = 'none';
  if (unknown.length > 0) {
    label = 'Difficulty: set PC levels';
    title = `Level missing for ${unknown.join(', ')} (Creature tab).`;
  } else if (report) {
    const { thresholds: t } = report;
    label = DIFFICULTY_LABEL[report.difficulty];
    tone = report.difficulty;
    title =
      `${xp(report.adjustedXp)} adjusted XP (${xp(report.baseXp)} × ${report.multiplier} for ` +
      `${monsterXp.length} monsters, ${party.length} characters)\n` +
      `Easy ${xp(t.easy)} · Medium ${xp(t.medium)} · Hard ${xp(t.hard)} · Deadly ${xp(t.deadly)}`;
  }
  return (
    <span className={`difficulty difficulty-${tone}`} title={title} aria-label={`${label}. ${title}`}>
      {label}
    </span>
  );
}
