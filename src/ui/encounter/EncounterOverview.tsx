import type { Encounter } from '@/core/model';
import { useEncounterStore } from '@/state/encounterStore';
import { Section } from '../kit';
import { DifficultyBreakdown } from './EncounterDifficulty';
import { HpBar } from './HpBar';

/** Creature tab with nothing selected: how the fight stands at a glance. */
export function EncounterOverview({ encounter }: { encounter: Encounter }) {
  const party = encounter.combatants.filter((c) => c.side === 'player');
  const enemies = encounter.combatants.filter((c) => c.side === 'enemy');
  const standing = enemies.filter((c) => c.hp.current > 0).length;
  return (
    <div className="col encounter-overview">
      <p className="muted small">Click a token or a name to see it here.</p>
      <Section title="Difficulty">
        <DifficultyBreakdown combatants={encounter.combatants} />
      </Section>
      <Section title="Party">
        {party.length === 0 && <p className="muted small">No player characters yet.</p>}
        {party.map((c) => (
          <button
            key={c.id}
            type="button"
            className="overview-member"
            onClick={() => useEncounterStore.getState().select(c.id)}
          >
            <span className="overview-name">{c.name}</span>
            <HpBar hp={c.hp} />
            <span className="hp small">
              {c.hp.current}/{c.hp.max}
              {c.hp.temp > 0 && <span className="muted">+{c.hp.temp}</span>}
            </span>
          </button>
        ))}
      </Section>
      <Section title="Monsters">
        <p className="small">
          {enemies.length === 0 ? 'No monsters yet.' : `${standing} of ${enemies.length} remaining`}
        </p>
      </Section>
    </div>
  );
}
