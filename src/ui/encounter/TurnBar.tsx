import { useState } from 'react';
import type { Combatant, CreatureAction, Encounter } from '@/core/model';
import type { RollMode } from '@/core/rules/dice';
import { SIDE_COLORS } from '@/render/tokens/tokenMaterials';
import { useAppStore } from '@/state/appStore';
import { currentCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button } from '../kit';
import { attackActions, attackLabel, resultSummary } from './attacks';
import { changeHp, rollAction, rollInitiativeFor, stepTurn } from './combatantCommands';
import { useCreature } from './creatureLookup';
import { useEncounterUi } from './encounterUiStore';
import { UnplacedChip } from './UnplacedChip';

const ROLL_MODE_LABEL: Record<RollMode, string> = {
  normal: 'Normal',
  advantage: 'Advantage',
  disadvantage: 'Disadvantage',
};
const ROLL_MODES = Object.keys(ROLL_MODE_LABEL) as RollMode[];

interface TurnProps {
  current: Combatant | null;
  /** Combatant quick damage and healing apply to: the selection, else the current one. */
  target: Combatant | null;
}

function TurnControls({ current, target }: TurnProps) {
  const reportError = useAppStore((s) => s.reportError);
  const rollMode = useEncounterUi((s) => s.rollMode);
  const creature = useCreature(current?.creature ?? null);
  const [result, setResult] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const value = Math.round(Number(amount));
  const valid = target !== null && amount.trim() !== '' && Number.isFinite(value) && value > 0;
  const attacks = attackActions(creature);

  // Library data may carry dice formulas that don't parse.
  const attack = (action: CreatureAction) => {
    try {
      const rolled = current && rollAction(current, action, rollMode);
      if (rolled) {
        setResult(`${action.name}: ${resultSummary(rolled)}`);
        setAmount(String(rolled.damage.reduce((sum, d) => sum + d.total, 0)));
      }
    } catch (error) {
      reportError(error);
    }
  };

  const applyHp = (change: 'damage' | 'heal') => {
    if (target && valid) {
      changeHp(target.id, change, value);
      setAmount('');
    }
  };

  return (
    <>
      <div className="turn-actions">
        {current && (
          <span className="turn-name">
            <span className="side-bar" style={{ background: SIDE_COLORS[current.side] }} />
            {current.name}
          </span>
        )}
        {attacks.map((a) => (
          <Button
            key={a.name}
            icon="swords"
            label={attackLabel(a)}
            title="Roll to hit and damage"
            onClick={() => attack(a)}
          />
        ))}
        {attacks.length > 0 && (
          <select
            aria-label="Roll mode"
            value={rollMode}
            onChange={(e) => useEncounterUi.setState({ rollMode: e.target.value as RollMode })}
          >
            {ROLL_MODES.map((m) => (
              <option key={m} value={m}>
                {ROLL_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        )}
        {result && (
          <span className="turn-result" title={result}>
            {result}
          </span>
        )}
      </div>
      <div className="turn-hp" title="Applies to the selected combatant">
        <span className="muted small">{target ? target.name : 'No target'}</span>
        <input
          type="number"
          min={1}
          placeholder="HP"
          aria-label={`Hit points for ${target?.name ?? 'the selected combatant'}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyHp('damage');
          }}
        />
        <Button icon="minus" label="Damage" variant="danger" disabled={!valid} onClick={() => applyHp('damage')} />
        <Button icon="plus" label="Heal" disabled={!valid} onClick={() => applyHp('heal')} />
      </div>
    </>
  );
}

/** Before the first turn: place the tokens, roll initiative, start; the header carries the accent. */
function SetupBar({ encounter, hasMap }: { encounter: Encounter; hasMap: boolean }) {
  const empty = encounter.combatants.length === 0;
  return (
    <footer className="play-turnbar play-setupbar" aria-label="Set up">
      <div className="turn-actions">
        <span className="muted">{empty ? 'Add creatures and player characters to start.' : 'Set up the fight.'}</span>
        {hasMap && <UnplacedChip />}
      </div>
      <Button
        icon="dice"
        label="Roll initiative"
        disabled={empty}
        title="Roll initiative for everyone and sort the order"
        onClick={() => rollInitiativeFor(null)}
      />
      <Button icon="next" label="Start combat" shortcut="Space" disabled={empty} onClick={() => stepTurn('next')} />
    </footer>
  );
}

/**
 * Bottom bar of Play. Set up: placing and initiative. Combat: the current combatant's attacks, quick
 * damage/heal and the turn buttons.
 */
export function TurnBar({ encounter, hasMap }: { encounter: Encounter; hasMap: boolean }) {
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const current = currentCombatant(encounter);
  const target = encounter.combatants.find((c) => c.id === selectedId) ?? current;
  return encounter.round > 0 ? (
    <footer className="play-turnbar" aria-label="Turn">
      <TurnControls key={current?.id ?? 'none'} current={current} target={target} />
      <Button icon="previous" label="Previous" shortcut="Shift+Space" onClick={() => stepTurn('previous')} />
      <Button icon="next" label="Next turn" variant="primary" shortcut="Space" onClick={() => stepTurn('next')} />
    </footer>
  ) : (
    <SetupBar encounter={encounter} hasMap={hasMap} />
  );
}
