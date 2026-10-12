import { useState } from 'react';
import { SPEEDS } from '@/core/model';
import { DiceError, parseDice, type RollMode } from '@/core/rules/dice';
import { PLAYER_DICE_PATTERN, PLAYER_LABEL_MAX, type PlayerSheet, type SyncPayload } from '@/sync/protocol';
import { HpBar } from '../encounter/HpBar';
import { Icon } from '../kit';
import { usePlayerStore } from './playerStore';

const QUICK_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const MODES: { mode: RollMode; label: string }[] = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'advantage', label: 'Advantage' },
  { mode: 'disadvantage', label: 'Disadvantage' },
];
// Wide screens have room beside the map; phones open the sheet on demand.
const OPEN_FROM_PX = 900;

function speedText(speeds: PlayerSheet['speeds']): string {
  return SPEEDS.flatMap((kind) => {
    const feet = speeds[kind];
    return feet === undefined ? [] : [kind === 'walk' ? `${feet} ft` : `${kind} ${feet} ft`];
  }).join(', ');
}

/** Filled dots for what is left, hollow ones for what is spent or failed. */
function Dots({ filled, total, label }: { filled: number; total: number; label: string }) {
  return (
    <span className="sheet-dots" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < filled ? 'dot filled' : 'dot'} />
      ))}
    </span>
  );
}

/** Dice for the character: the DM rolls them, writes them into the log and the answer appears below. */
function PlayerDice({ send }: { send: (payload: SyncPayload) => void }) {
  const rolls = usePlayerStore((s) => s.rolls);
  const [dice, setDice] = useState('1d20');
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<RollMode>('normal');
  const [problem, setProblem] = useState<string | null>(null);

  // The same checks the DM's roll makes, so a typo is explained here.
  const roll = (expression: string, rollMode: RollMode) => {
    try {
      const parsed = parseDice(expression);
      if (!PLAYER_DICE_PATTERN.test(expression)) {
        throw new DiceError('Use only digits, d, + and -', expression);
      }
      if (rollMode !== 'normal' && !parsed.terms.some((t) => t.count === 1 && t.sides === 20)) {
        throw new DiceError(`${rollMode} needs a single d20 term`, expression);
      }
      send({ type: 'roll', dice: expression, mode: rollMode, label: label.trim() });
      setProblem(null);
    } catch (error) {
      if (!(error instanceof DiceError)) throw error;
      setProblem(error.message);
    }
  };

  return (
    <div className="sheet-dice">
      <div className="row">
        <input
          className="grow"
          aria-label="Dice expression"
          value={dice}
          onChange={(e) => setDice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') roll(dice, mode);
          }}
        />
        <button className="primary" onClick={() => roll(dice, mode)}>
          <Icon name="dice" /> Roll
        </button>
      </div>
      <input
        aria-label="What the roll is for"
        placeholder="For (optional), e.g. Perception"
        maxLength={PLAYER_LABEL_MAX}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className="row wrap dice-buttons">
        {QUICK_DICE.map((die) => (
          // Advantage only exists for d20 rolls.
          <button key={die} onClick={() => roll(`1${die}`, die === 'd20' ? mode : 'normal')}>
            {die}
          </button>
        ))}
      </div>
      <div className="row wrap" role="group" aria-label="Roll mode">
        {MODES.map((m) => (
          <button key={m.mode} className={mode === m.mode ? 'active' : ''} onClick={() => setMode(m.mode)}>
            {m.label}
          </button>
        ))}
      </div>
      {problem && <div className="error-text">{problem}</div>}
      {rolls.length > 0 && (
        <ol className="sheet-rolls" aria-label="Your rolls, newest first">
          {rolls.map((text, i) => (
            <li key={`${rolls.length - i}`} className={i === 0 ? 'dice-result' : 'muted'}>
              {text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The character's own sheet on its player link: hit points, armour class, speed, conditions, death saves,
 * spell slots and dice. A side panel on wide screens, a bottom sheet on phones; both collapse to one line.
 */
export function PlayerSheetPanel({ sheet, send }: { sheet: PlayerSheet; send: (payload: SyncPayload) => void }) {
  const [open, setOpen] = useState(() => window.innerWidth >= OPEN_FROM_PX);
  const { hp } = sheet;
  const temp = hp.temp > 0 ? ` +${hp.temp}` : '';
  const speed = speedText(sheet.speeds);
  return (
    <aside className={open ? 'player-sheet open' : 'player-sheet'} aria-label={`${sheet.name}'s sheet`}>
      <button className="sheet-handle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="user" />
        <strong>{sheet.name}</strong>
        <span className="sheet-summary">
          <Icon name="heart" /> {hp.current}/{hp.max}
          {temp} <Icon name="shield" /> {sheet.armorClass}
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} />
      </button>
      {open && (
        <div className="sheet-body">
          <div className="sheet-hp">
            <span>
              Hit points <strong>{hp.current}</strong> of {hp.max}
              {hp.temp > 0 && ` · ${hp.temp} temporary`}
            </span>
            <HpBar hp={hp} />
          </div>
          <div className="row wrap">
            <span className="sheet-stat">
              <Icon name="shield" /> AC <strong>{sheet.armorClass}</strong>
            </span>
            {speed !== '' && <span className="sheet-stat">Speed {speed}</span>}
          </div>
          <div className="row wrap sheet-chips" aria-label="Conditions">
            {sheet.conditions.length === 0 && !sheet.concentrating && <span className="muted">No conditions</span>}
            {sheet.conditions.map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
            {sheet.concentrating && <span className="chip">Concentrating</span>}
          </div>
          {sheet.deathSaves && (
            <div className="sheet-saves">
              <span>Death saves</span>
              <Dots
                filled={sheet.deathSaves.successes}
                total={3}
                label={`${sheet.deathSaves.successes} of 3 successes`}
              />
              <Dots filled={sheet.deathSaves.failures} total={3} label={`${sheet.deathSaves.failures} of 3 failures`} />
            </div>
          )}
          {sheet.slots.length > 0 && (
            <div className="sheet-slots" aria-label="Spell slots">
              {sheet.slots.map((s) => (
                <div key={s.level} className="row">
                  <span className="sheet-slot-level">Level {s.level}</span>
                  <Dots
                    filled={Math.max(0, s.max - s.used)}
                    total={s.max}
                    label={`${s.max - s.used} of ${s.max} left`}
                  />
                </div>
              ))}
            </div>
          )}
          <PlayerDice send={send} />
        </div>
      )}
    </aside>
  );
}
