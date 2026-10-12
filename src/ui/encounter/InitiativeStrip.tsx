import { useState } from 'react';
import type { Combatant, Encounter } from '@/core/model';
import { SIDE_COLORS } from '@/render/tokens/tokenMaterials';
import { currentCombatant, moveCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { OptionalNumberInput } from '../creature/creatureFields';
import { Button, Icon } from '../kit';
import { patchCombatant, rollInitiativeFor, sortInitiative } from './combatantCommands';
import { useEncounterUi } from './encounterUiStore';
import { HpBar } from './HpBar';
import { openCombatantMenu } from './tokenMenu';

interface RowProps {
  c: Combatant;
  current: boolean;
  selected: boolean;
  onDragStart: () => void;
  onDrop: () => void;
}

function StripRow({ c, current, selected, onDragStart, onDrop }: RowProps) {
  const classes = ['strip-row', current ? 'current' : '', selected ? 'selected' : '', c.hp.current <= 0 ? 'down' : ''];
  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      aria-current={current ? 'step' : undefined}
      className={classes.join(' ')}
      onClick={() => useEncounterStore.getState().select(c.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') useEncounterStore.getState().select(c.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openCombatantMenu(c.id, e.clientX, e.clientY);
      }}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      title={`${c.name} · ${c.side} · AC ${c.armorClass} · right-click for actions, drag to reorder`}
    >
      <span className="turn-marker">{current && <Icon name="play" size={12} title="Current turn" />}</span>
      <span className="side-bar" style={{ background: SIDE_COLORS[c.side] }} />
      <div className="strip-main">
        <div className="strip-name">
          <span className="strip-label">{c.name}</span>
          {c.hiddenFromPlayers && <Icon name="eyeOff" size={14} title="Hidden from players" />}
          {!c.position && <span className="muted small">off map</span>}
        </div>
        <div className="strip-hp">
          <HpBar hp={c.hp} />
          <span className="hp small">
            {c.hp.current}/{c.hp.max}
            {c.hp.temp > 0 && <span className="muted">+{c.hp.temp}</span>}
          </span>
        </div>
        {c.conditions.length > 0 && <div className="muted small strip-conditions">{c.conditions.join(', ')}</div>}
      </div>
      <OptionalNumberInput
        className="init-input"
        placeholder="init"
        value={c.initiative ?? undefined}
        onChange={(v) => patchCombatant(c.id, `Initiative of ${c.name}`, (d) => void (d.initiative = v ?? null))}
      />
    </div>
  );
}

/** Left column of Play: the turn order only; everything else about a combatant lives in the inspector. */
export function InitiativeStrip({ encounter }: { encounter: Encounter }) {
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const update = useEncounterStore((s) => s.update);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const currentId = currentCombatant(encounter)?.id;
  const empty = encounter.combatants.length === 0;

  return (
    <aside className="play-strip" aria-label="Initiative">
      <div className="strip-head">
        <h2>Initiative</h2>
        <span className="muted small">{encounter.round > 0 ? `Round ${encounter.round}` : 'Not started'}</span>
      </div>
      <div className="strip-list">
        {encounter.combatants.map((c, i) => (
          <StripRow
            key={c.id}
            c={c}
            current={c.id === currentId}
            selected={c.id === selectedId}
            onDragStart={() => setDragIndex(i)}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== i) update((d) => moveCombatant(d, dragIndex, i), 'Reorder');
              setDragIndex(null);
            }}
          />
        ))}
        {empty && <p className="muted small strip-empty">Add creatures and player characters to start.</p>}
      </div>
      <div className="strip-foot">
        <div className="row">
          <Button
            icon="dice"
            label="Roll all"
            disabled={empty}
            title="Roll initiative for everyone"
            onClick={() => rollInitiativeFor(null)}
          />
          <Button
            label="NPCs"
            disabled={empty}
            title="Roll initiative for everyone except player characters"
            onClick={() => rollInitiativeFor(encounter.combatants.filter((c) => c.side !== 'player').map((c) => c.id))}
          />
          <Button label="Sort" disabled={empty} title="Sort by initiative, ties by Dex" onClick={sortInitiative} />
        </div>
        <Button
          icon="plus"
          label="Add"
          variant="primary"
          onClick={() => useEncounterUi.setState({ addDialogOpen: true })}
        />
      </div>
    </aside>
  );
}
