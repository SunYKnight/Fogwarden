import { useState } from 'react';
import type { Combatant, CreatureAction, Encounter } from '@/core/model';
import { formatModifier } from '@/core/rules/abilities';
import type { RollMode } from '@/core/rules/dice';
import { SIDE_COLORS } from '@/render/tokens/tokenMaterials';
import { useAppStore } from '@/state/appStore';
import { currentCombatant, type AttackResult } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button } from '../kit';
import { changeHp, endCombat, rollAction, stepTurn } from './combatantCommands';
import { useCreature } from './creatureLookup';
import { useEncounterUi } from './encounterUiStore';

const ROLL_MODE_LABEL: Record<RollMode, string> = {
  normal: 'Normal',
  advantage: 'Advantage',
  disadvantage: 'Disadvantage',
};
const ROLL_MODES = Object.keys(ROLL_MODE_LABEL) as RollMode[];

function attackLabel(action: CreatureAction): string {
  const damage = action.attack?.damage.map((d) => d.formula).join(' + ') ?? '';
  return `${action.name} ${formatModifier(action.attack?.toHit ?? 0)}${damage ? ` · ${damage}` : ''}`;
}

/** Short inline form of the log line: "17 to hit · 5 slashing". */
function resultSummary(result: AttackResult): string {
  const natural = result.toHit.terms[0]?.kept[0];
  const mark = result.critical ? ' CRITICAL' : natural === 1 ? ' (natural 1)' : '';
  const damage = result.damage.map((d) => `${d.total} ${d.type}`).join(' + ');
  return `${result.toHit.total} to hit${mark}${damage ? ` · ${damage}` : ''}`;
}

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
  const attacks = [...(creature?.actions ?? []), ...(creature?.bonusActions ?? [])].filter((a) => a.attack);

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
        {current ? (
          <span className="turn-name">
            <span className="side-bar" style={{ background: SIDE_COLORS[current.side] }} />
            {current.name}
          </span>
        ) : (
          <span className="muted">Roll initiative, then start combat.</span>
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

/** Bottom bar of Play: the current combatant's attacks, quick damage/heal and the turn buttons. */
export function TurnBar({ encounter }: { encounter: Encounter }) {
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const current = currentCombatant(encounter);
  const target = encounter.combatants.find((c) => c.id === selectedId) ?? current;
  const started = encounter.round > 0;
  return (
    <footer className="play-turnbar" aria-label="Turn">
      <TurnControls key={current?.id ?? 'none'} current={current} target={target} />
      <Button label="End combat" variant="ghost" disabled={!started} onClick={endCombat} />
      <Button
        icon="previous"
        label="Previous"
        shortcut="Shift+Space"
        disabled={!started}
        onClick={() => stepTurn('previous')}
      />
      <Button
        icon="next"
        label={started ? 'Next turn' : 'Start combat'}
        variant="primary"
        shortcut="Space"
        disabled={encounter.combatants.length === 0}
        onClick={() => stepTurn('next')}
      />
    </footer>
  );
}
