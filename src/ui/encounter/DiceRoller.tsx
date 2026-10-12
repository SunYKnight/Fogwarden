import { useState } from 'react';
import { DiceError, rollDice, type RollMode } from '@/core/rules/dice';
import { useAppStore } from '@/state/appStore';
import { addLog, describeRoll } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useEncounterUi } from './encounterUiStore';

const QUICK_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const MODES: { mode: RollMode; label: string }[] = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'advantage', label: 'Advantage' },
  { mode: 'disadvantage', label: 'Disadvantage' },
];

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
    <div className="panel">
      <h2>Dice</h2>
      <div className="row">
        <input
          className="grow"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') roll(expression, rollMode);
          }}
        />
        <button className="primary" onClick={() => roll(expression, rollMode)}>
          Roll
        </button>
      </div>
      <div className="row wrap dice-buttons">
        {QUICK_DICE.map((die) => (
          // Advantage only exists for d20 rolls.
          <button key={die} onClick={() => roll(`1${die}`, die === 'd20' ? rollMode : 'normal')}>
            {die}
          </button>
        ))}
      </div>
      <div className="row wrap">
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            className={rollMode === mode ? 'active' : ''}
            onClick={() => useEncounterUi.setState({ rollMode: mode })}
          >
            {label}
          </button>
        ))}
      </div>
      {problem && <div className="error-text">{problem}</div>}
      {last && <div className="dice-result">{last}</div>}
    </div>
  );
}
