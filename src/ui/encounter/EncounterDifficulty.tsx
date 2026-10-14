import type { Combatant } from '@/core/model';
import { countOf } from '@/core/plural';
import {
  encounterDifficulty,
  type Difficulty,
  type DifficultyReport,
  type XpThresholds,
} from '@/core/rules/difficulty';
import { useLibraryStore } from '@/state/libraryStore';

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  trivial: 'Trivial',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  deadly: 'Deadly',
};

const THRESHOLDS: (keyof XpThresholds)[] = ['easy', 'medium', 'hard', 'deadly'];

const xp = (n: number) => n.toLocaleString('en-US');

interface Rating {
  label: string;
  /** Why: the XP sum and thresholds, or what is missing to rate. */
  title: string;
  tone: Difficulty | 'none';
  report: DifficultyReport | null;
}

/**
 * DMG difficulty of the enemies (plus `extraXp`, monsters about to be added) for the player characters;
 * without a report while levels are missing.
 */
function useRating(combatants: readonly Combatant[], extraXp: readonly number[]): Rating {
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
  let rating: Rating = {
    label: 'Difficulty: no party',
    title: 'Add player characters with a level to rate the encounter.',
    tone: 'none',
    report: null,
  };
  if (unknown.length > 0) {
    rating = {
      label: 'Difficulty: set PC levels',
      title: `Level missing for ${unknown.join(', ')} (Stats tab of the creature dock).`,
      tone: 'none',
      report: null,
    };
  } else if (report) {
    const { thresholds: t } = report;
    rating = {
      label: DIFFICULTY_LABEL[report.difficulty],
      tone: report.difficulty,
      report,
      title:
        `${xp(report.adjustedXp)} adjusted XP (${xp(report.baseXp)} × ${report.multiplier} for ` +
        `${countOf(monsterXp.length, 'monster')}, ${countOf(party.length, 'character')})\n` +
        THRESHOLDS.map((key) => `${DIFFICULTY_LABEL[key]} ${xp(t[key])}`).join(' · '),
    };
  }
  return rating;
}

interface BadgeProps {
  combatants: readonly Combatant[];
  extraXp?: number[];
  /** Makes the badge a button, e.g. to open the breakdown. */
  onClick?: () => void;
}

/** Difficulty in one word with the numbers in the tooltip; asks for the levels it still needs. */
export function DifficultyBadge({ combatants, extraXp = [], onClick }: BadgeProps) {
  const { label, title, tone } = useRating(combatants, extraXp);
  const className = `difficulty difficulty-${tone}`;
  return onClick ? (
    <button type="button" className={`${className} difficulty-link`} title={title} onClick={onClick}>
      {label}
    </button>
  ) : (
    <span className={className} title={title} aria-label={`${label}. ${title}`}>
      {label}
    </span>
  );
}

/** What makes the rating: adjusted XP against each threshold, the reached one marked. */
export function DifficultyBreakdown({ combatants }: { combatants: readonly Combatant[] }) {
  const { label, title, tone, report } = useRating(combatants, []);
  return (
    <div className="col difficulty-breakdown">
      <div className="row">
        <span className={`difficulty difficulty-${tone}`}>{label}</span>
        {report && <span className="muted small">{xp(report.adjustedXp)} adjusted XP</span>}
      </div>
      {report ? (
        <>
          <p className="muted small">
            {xp(report.baseXp)} XP × {report.multiplier} for the number of monsters and characters
          </p>
          <ul className="difficulty-thresholds">
            {THRESHOLDS.map((key) => (
              <li key={key} className={report.adjustedXp >= report.thresholds[key] ? 'reached' : ''}>
                <span>{DIFFICULTY_LABEL[key]}</span>
                <span>{xp(report.thresholds[key])}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted small">{title}</p>
      )}
    </div>
  );
}
