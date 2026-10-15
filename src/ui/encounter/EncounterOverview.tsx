import type { Encounter } from '@/core/model';
import { useEncounterStore } from '@/state/encounterStore';
import { NotesEditor } from '../campaign/campaignUi';
import { Section } from '../kit';
import { DifficultyBreakdown } from './EncounterDifficulty';
import { HpBar } from './HpBar';

/** Encounter tab: how the fight stands at a glance. */
export function EncounterOverview({ encounter }: { encounter: Encounter }) {
  const party = encounter.combatants.filter((c) => c.side === 'player');
  const enemies = encounter.combatants.filter((c) => c.side === 'enemy');
  const standing = enemies.filter((c) => c.hp.current > 0).length;
  return (
    <div className="col encounter-overview">
      <p className="muted small">Click a token or a name to show it in the creature dock under the map.</p>
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
      <Section title="Notes">
        <NotesEditor
          key={encounter.id}
          value={encounter.notes}
          label="Encounter notes"
          placeholder="Setup, tactics, treasure: only you see these notes."
          onCommit={async (text) => {
            useEncounterStore.getState().update((d) => {
              d.notes = text;
            }, 'Edit encounter notes');
          }}
        />
      </Section>
    </div>
  );
}
