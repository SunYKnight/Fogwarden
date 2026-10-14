import { useState } from 'react';
import { DiceError, rollDice, type RollMode } from '@/core/rules/dice';
import { useAppStore } from '@/state/appStore';
import { addLog, describeRoll } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button } from '../kit';
import { ROLL_MODE_LABEL, ROLL_MODES } from './DockTabs';
import { useEncounterUi } from './encounterUiStore';

const QUICK_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

/** Free dice expressions and quick dice; the advantage mode also applies to attack buttons. */
export function DiceRoller() {
  const update = useEncounterStore((s) => s.update);
  const reportError = useAppStore((s) => s.reportError);
  const rollMode = useEncounterUi((s) => s.rollMode);
  const [expression, setExpression] = useState('1d20');
  const [problem, setProblem] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  // A typo in the expression is shown next to the input, not as an app error.
  const roll = (expr: string, mode: RollMode) => {
    try {
      const result = rollDice(expr, { mode });
      const modeText = mode === 'normal' ? '' : ` with ${mode}`;
      const text = `${result.expression}${modeText}: ${describeRoll(result)}`;
      update((d) => addLog(d, 'roll', text));
      setLast(text);
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof DiceError ? error.message : null);
      if (!(error instanceof DiceError)) reportError(error);
    }
  };

  return (
    <div className="col">
      <div className="row">
        <input
          className="grow"
          aria-label="Dice expression"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') roll(expression, rollMode);
          }}
        />
        <Button icon="dice" label="Roll" onClick={() => roll(expression, rollMode)} />
      </div>
      <div className="row wrap dice-buttons">
        {QUICK_DICE.map((die) => (
          // Advantage only exists for d20 rolls.
          <Button key={die} label={die} onClick={() => roll(`1${die}`, die === 'd20' ? rollMode : 'normal')} />
        ))}
      </div>
      <div className="row wrap" role="group" aria-label="Roll mode">
        {ROLL_MODES.map((mode) => (
          <Button
            key={mode}
            label={ROLL_MODE_LABEL[mode]}
            active={rollMode === mode}
            onClick={() => useEncounterUi.setState({ rollMode: mode })}
          />
        ))}
      </div>
      {problem && <div className="error-text">{problem}</div>}
      {last && <div className="dice-result">{last}</div>}
    </div>
  );
}
