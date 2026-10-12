import { useState } from 'react';
import type { Encounter } from '@/core/model';
import { SIDE_COLORS } from '@/render/tokens/TokenView';
import {
  addLog,
  currentCombatant,
  describeRoll,
  moveCombatant,
  nextTurn,
  previousTurn,
  removeCombatant,
  rollInitiative,
  sortByInitiative,
} from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { confirmDialog } from '../kit';
import { OptionalNumberInput } from '../creature/creatureFields';
import { dexScore } from './creatureLookup';

function rollFor(ids: string[] | null): void {
  useEncounterStore.getState().update((d) => {
    d.combatants
      .filter((c) => ids === null || ids.includes(c.id))
      .forEach((c) => {
        const roll = rollInitiative(dexScore(c));
        c.initiative = roll.total;
        addLog(d, 'roll', `${c.name} initiative ${describeRoll(roll)}`);
      });
    sortByInitiative(d, dexScore);
  });
}

/** Turn changes select the combatant whose turn it is, so its stat block shows up. */
function step(direction: 'next' | 'previous'): void {
  useEncounterStore.getState().update((d) => {
    if (direction === 'next') nextTurn(d);
    else previousTurn(d);
    const current = currentCombatant(d);
    if (current) addLog(d, 'turn', `Round ${d.round}: ${current.name}`);
  });
  const { encounter, select } = useEncounterStore.getState();
  const current = encounter && currentCombatant(encounter);
  if (current) select(current.id);
}

export function InitiativeTracker({ encounter }: { encounter: Encounter }) {
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const select = useEncounterStore((s) => s.select);
  const update = useEncounterStore((s) => s.update);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const currentId = currentCombatant(encounter)?.id;
  const started = encounter.round > 0;

  return (
    <div className="panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Initiative</h2>
        <div className="spacer" />
        <strong>{started ? `Round ${encounter.round}` : 'Not started'}</strong>
      </div>
      <div className="row wrap tracker-buttons">
        <button disabled={!started} onClick={() => step('previous')} title="Previous turn">
          ◀ Prev
        </button>
        <button
          className="primary"
          disabled={encounter.combatants.length === 0}
          onClick={() => step('next')}
          title="Next turn"
        >
          {started ? 'Next ▶' : 'Start ▶'}
        </button>
        <button
          disabled={!started}
          onClick={() =>
            update((d) => {
              d.round = 0;
              d.turnIndex = 0;
              addLog(d, 'turn', 'Combat ended');
            })
          }
          title="End combat"
        >
          End
        </button>
      </div>
      <div className="row wrap tracker-buttons">
        <span className="muted">Roll</span>
        <button onClick={() => rollFor(null)}>All</button>
        <button
          onClick={() => rollFor(encounter.combatants.filter((c) => c.side !== 'player').map((c) => c.id))}
          title="Every combatant except player characters"
        >
          NPCs
        </button>
        <button disabled={!selectedId} onClick={() => selectedId && rollFor([selectedId])}>
          Selected
        </button>
        <button onClick={() => update((d) => sortByInitiative(d, dexScore))} title="Sort by initiative, ties by Dex">
          Sort
        </button>
      </div>
      <div className="list">
        {encounter.combatants.map((c, i) => (
          <div
            key={c.id}
            draggable
            className={[
              'list-item tracker-row',
              c.id === selectedId ? 'selected' : '',
              c.id === currentId ? 'current' : '',
              c.hp.current <= 0 ? 'down' : '',
            ].join(' ')}
            onClick={() => select(c.id)}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== i) update((d) => moveCombatant(d, dragIndex, i));
              setDragIndex(null);
            }}
          >
            <span className="side-dot" style={{ background: SIDE_COLORS[c.side] }} title={c.side} />
            <span className="grow">
              {c.name}
              {c.hiddenFromPlayers && <span title="Hidden from players"> 🙈</span>}
              {!c.position && <span className="muted"> · off map</span>}
              {c.conditions.length > 0 && <div className="muted small">{c.conditions.join(', ')}</div>}
            </span>
            <OptionalNumberInput
              className="init-input"
              placeholder="init"
              value={c.initiative ?? undefined}
              onChange={(v) => update((d) => void (d.combatants[i]!.initiative = v ?? null))}
            />
            <span className="hp" title="Hit points (temp)">
              {c.hp.current}/{c.hp.max}
              {c.hp.temp > 0 && <span className="muted">+{c.hp.temp}</span>}
            </span>
            <span className="muted small">AC {c.armorClass}</span>
            <button
              title="Remove from encounter"
              onClick={(e) => {
                e.stopPropagation();
                void confirmDialog({
                  title: 'Remove combatant',
                  message: `${c.name} leaves the encounter with its HP, conditions and notes.`,
                  confirmLabel: 'Remove',
                  danger: true,
                }).then((ok) => ok && update((d) => removeCombatant(d, c.id)));
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {encounter.combatants.length === 0 && <p className="muted">Add creatures and player characters below.</p>}
    </div>
  );
}
