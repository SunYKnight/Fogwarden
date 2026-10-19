import { useState } from 'react';
import { SPEEDS, type DeathSaves } from '@/core/model';
import { DiceError, parseDice, type RollMode } from '@/core/rules/dice';
import {
  PLAYER_DICE_PATTERN,
  PLAYER_LABEL_MAX,
  PLAYER_NOTE_MAX,
  type PlayerEncounter,
  type PlayerSheet,
  type SyncPayload,
} from '@/sync/protocol';
import { HpBar } from '../encounter/HpBar';
import { Icon, Tabs } from '../kit';
import {
  SheetEditNumber,
  SheetNumber,
  sheetTabsFor,
  SheetTabBody,
  type SheetEditor,
  type SheetEditRequests,
  type SheetNotes,
} from '../sheet/CharacterSheetTabs';
import { usePlayerStore } from './playerStore';
import { waitingEdit } from './waitingEdits';

const QUICK_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const MODES: { mode: RollMode; label: string }[] = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'advantage', label: 'Advantage' },
  { mode: 'disadvantage', label: 'Disadvantage' },
];
// Wide screens have room beside the map; phones open the sheet on demand.
const OPEN_FROM_PX = 900;
const COMBAT_TAB = { id: 'combat', label: 'Combat' };
// Beyond any spell or feature; the DM refuses more.
const TEMP_HP_MAX = 999;

/** Checks a roll, then sends it; the DM rolls, logs and answers. */
type Roll = (dice: string, mode: RollMode, label: string) => void;

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

/** Roll mode buttons and, while the campaign lets players share rolls, whether everyone sees the next ones. */
function RollModes(props: { mode: RollMode; setMode: (mode: RollMode) => void; share: Share | null }) {
  const { mode, setMode, share } = props;
  return (
    <div className="row wrap" role="group" aria-label="Roll mode">
      {MODES.map((m) => (
        <button key={m.mode} className={mode === m.mode ? 'active' : ''} onClick={() => setMode(m.mode)}>
          {m.label}
        </button>
      ))}
      {share && (
        <label className="sheet-share" title="Shared rolls show in the chat of every player">
          <input type="checkbox" checked={share.on} onChange={(e) => share.set(e.target.checked)} /> Show everyone
        </label>
      )}
    </div>
  );
}

interface Share {
  on: boolean;
  set: (on: boolean) => void;
}

/** The DM's answers to this view's rolls, newest first; `latest` shows only the newest. */
function RollResults({ latest }: { latest: boolean }) {
  const rolls = usePlayerStore((s) => s.rolls);
  const shown = latest ? rolls.slice(0, 1) : rolls;
  return (
    shown.length > 0 && (
      <ol className="sheet-rolls" aria-label={latest ? 'Your last roll' : 'Your rolls, newest first'}>
        {shown.map((text, i) => (
          <li key={`${rolls.length - i}`} className={i === 0 ? 'dice-result' : 'muted'}>
            {text}
          </li>
        ))}
      </ol>
    )
  );
}

interface DiceProps {
  roll: Roll;
  mode: RollMode;
  setMode: (mode: RollMode) => void;
  share: Share | null;
}

/** Dice for the character: the DM rolls them, writes them into the log and the answer appears below. */
function PlayerDice({ roll, mode, setMode, share }: DiceProps) {
  const [dice, setDice] = useState('1d20');
  const [label, setLabel] = useState('');
  return (
    <div className="sheet-dice">
      <div className="row">
        <input
          className="grow"
          aria-label="Dice expression"
          value={dice}
          onChange={(e) => setDice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') roll(dice, mode, label.trim());
          }}
        />
        <button className="primary" onClick={() => roll(dice, mode, label.trim())}>
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
          <button key={die} onClick={() => roll(`1${die}`, die === 'd20' ? mode : 'normal', label.trim())}>
            {die}
          </button>
        ))}
      </div>
      <RollModes mode={mode} setMode={setMode} share={share} />
    </div>
  );
}

/** Death save successes and failures, one edit for both; the pair asked for shows until the DM answers. */
function DeathSaveFields({ saves, edit }: { saves: DeathSaves; edit: SheetEditRequests }) {
  const confirmed = { field: 'deathSaves', successes: saves.successes, failures: saves.failures } as const;
  const waiting = edit.waiting(confirmed);
  const shown = waiting ?? confirmed;
  return (
    <>
      <SheetNumber
        value={shown.successes}
        min={0}
        max={3}
        label="Death save successes"
        waiting={shown.successes !== saves.successes}
        onChange={(successes) => edit.send({ ...shown, successes }, confirmed)}
      />
      <SheetNumber
        value={shown.failures}
        min={0}
        max={3}
        label="Death save failures"
        waiting={shown.failures !== saves.failures}
        onChange={(failures) => edit.send({ ...shown, failures }, confirmed)}
      />
    </>
  );
}

/**
 * Hit points, armour class, speed, conditions, death saves, spell slots, hit dice and dice; with `edit` the
 * player changes hit points, temporary hit points, death saves, spent slots and hit dice.
 */
function CombatTab({ sheet, dice, edit }: { sheet: PlayerSheet; dice: DiceProps; edit: SheetEditor }) {
  const { hp, hitDice } = sheet;
  const speed = speedText(sheet.speeds);
  return (
    <>
      <div className="sheet-hp">
        {edit ? (
          <span className="row wrap">
            Hit points
            <SheetEditNumber
              edit={edit}
              confirmed={{ field: 'hp', value: Math.max(0, hp.current) }}
              min={0}
              max={hp.max}
              label="Hit points"
            />
            of {hp.max} · temporary
            <SheetEditNumber
              edit={edit}
              confirmed={{ field: 'tempHp', value: hp.temp }}
              min={0}
              max={TEMP_HP_MAX}
              label="Temporary hit points"
            />
          </span>
        ) : (
          <span>
            Hit points <strong>{hp.current}</strong> of {hp.max}
            {hp.temp > 0 && ` · ${hp.temp} temporary`}
          </span>
        )}
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
          {edit ? (
            <DeathSaveFields saves={sheet.deathSaves} edit={edit} />
          ) : (
            <>
              <Dots
                filled={sheet.deathSaves.successes}
                total={3}
                label={`${sheet.deathSaves.successes} of 3 successes`}
              />
              <Dots filled={sheet.deathSaves.failures} total={3} label={`${sheet.deathSaves.failures} of 3 failures`} />
            </>
          )}
        </div>
      )}
      {sheet.slots.length > 0 && (
        <div className="sheet-slots" aria-label="Spell slots">
          {sheet.slots.map((s) => (
            <div key={s.level} className="row">
              <span className="sheet-slot-level">Level {s.level}</span>
              <Dots filled={Math.max(0, s.max - s.used)} total={s.max} label={`${s.max - s.used} of ${s.max} left`} />
              {edit && (
                <SheetEditNumber
                  edit={edit}
                  confirmed={{ field: 'slotsUsed', level: s.level, value: s.used }}
                  min={0}
                  max={s.max}
                  label={`Level ${s.level} slots used`}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {hitDice && (
        <div className="row wrap" aria-label="Hit dice">
          <span className="sheet-slot-level">Hit dice</span>
          <Dots
            filled={Math.max(0, hitDice.max - hitDice.used)}
            total={hitDice.max}
            label={`${hitDice.max - hitDice.used} of ${hitDice.max} left`}
          />
          {edit && (
            <SheetEditNumber
              edit={edit}
              confirmed={{ field: 'hitDiceUsed', value: hitDice.used }}
              min={0}
              max={hitDice.max}
              label="Hit dice spent"
            />
          )}
        </div>
      )}
      <PlayerDice {...dice} />
    </>
  );
}

/** The character's notes on its own link: the DM's stored text, written back by the notes tab. */
function usePlayerNotes(on: boolean, send: (payload: SyncPayload) => void): SheetNotes | null {
  const text = usePlayerStore((s) => s.notes);
  const receive = usePlayerStore((s) => s.receive);
  const onCommit = (notes: string) => {
    let saved: Promise<unknown>;
    if (notes.length > PLAYER_NOTE_MAX) {
      const message = `Notes may have at most ${PLAYER_NOTE_MAX} characters; shorten them to save`;
      receive({ type: 'notice', text: message });
      saved = Promise.reject(new Error(message));
    } else {
      send({ type: 'note', text: notes });
      saved = Promise.resolve();
    }
    return saved;
  };
  return on && text !== null ? { text, onCommit } : null;
}

/**
 * The character's own sheet on its player link: the Combat tab (hit points, armour class, speed, conditions,
 * death saves, spell slots, hit dice and dice), while the DM shares the full sheet the tabs of `SHEET_TABS` with
 * roll buttons for saves and skills, and the notes tab while the campaign keeps player notes. Values become
 * editable while the campaign lets players change them. A side panel on wide screens, a bottom sheet on phones;
 * both collapse to one line.
 */
export function PlayerSheetPanel(props: {
  sheet: PlayerSheet;
  flags: Pick<PlayerEncounter, 'sharedRolls' | 'notes' | 'sheetEdits'>;
  send: (payload: SyncPayload) => void;
}) {
  const { sheet, flags, send } = props;
  const [open, setOpen] = useState(() => window.innerWidth >= OPEN_FROM_PX);
  const [tab, setTab] = useState(COMBAT_TAB.id);
  const [mode, setMode] = useState<RollMode>('normal');
  const [shareOn, setShareOn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const received = usePlayerStore((s) => s.details);
  const waitingEdits = usePlayerStore((s) => s.waitingEdits);
  const waitForEdit = usePlayerStore((s) => s.waitForEdit);
  const notes = usePlayerNotes(flags.notes === true, send);
  // Content of an older revision or another character is no longer this sheet.
  const details =
    sheet.details && received?.id === sheet.id && received.revision === sheet.details.revision
      ? received.content
      : null;
  const tabs = sheetTabsFor(details, notes);
  const detailTab = tabs.find((t) => t.id === tab);
  const share = flags.sharedRolls ? { on: shareOn, set: setShareOn } : null;
  const approve = flags.sheetEdits === 'approve';
  // 'auto' applies an edit at once, so the sheet's value is never behind.
  const edit: SheetEditor = flags.sheetEdits
    ? {
        send: (change, confirmed) => {
          if (approve) waitForEdit(change, confirmed);
          send({ type: 'sheetEdit', combatantId: sheet.id, edit: change });
        },
        waiting: (confirmed) => (approve ? waitingEdit(waitingEdits, confirmed) : null),
      }
    : null;
  const rolls = detailTab === undefined || (detailTab.kind === 'details' && detailTab.rolls === true);
  const { hp } = sheet;
  const temp = hp.temp > 0 ? ` +${hp.temp}` : '';

  // The same checks the DM's roll makes, so a typo is explained here.
  const roll: Roll = (expression, rollMode, label) => {
    try {
      const parsed = parseDice(expression);
      if (!PLAYER_DICE_PATTERN.test(expression)) {
        throw new DiceError('Use only digits, d, + and -', expression);
      }
      if (rollMode !== 'normal' && !parsed.terms.some((t) => t.count === 1 && t.sides === 20)) {
        throw new DiceError(`${rollMode} needs a single d20 term`, expression);
      }
      send({ type: 'roll', dice: expression, mode: rollMode, label, ...(share?.on && { share: true }) });
      setProblem(null);
    } catch (error) {
      if (!(error instanceof DiceError)) throw error;
      setProblem(error.message);
    }
  };

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
      {open && tabs.length > 0 && (
        <Tabs tabs={[COMBAT_TAB, ...tabs]} value={detailTab?.id ?? COMBAT_TAB.id} onChange={setTab} label="Sheet" />
      )}
      {open && (
        <div className="sheet-body">
          {edit && flags.sheetEdits === 'approve' && (detailTab === undefined || detailTab.id === 'inventory') && (
            <p className="muted small">The DM accepts each change before it counts.</p>
          )}
          {detailTab ? (
            <>
              <SheetTabBody
                key={`${sheet.id}:${detailTab.id}`}
                tab={detailTab}
                details={details}
                notes={notes}
                roll={(dice, label) => roll(dice, mode, label)}
                edit={edit}
              />
              {rolls && <RollModes mode={mode} setMode={setMode} share={share} />}
            </>
          ) : (
            <CombatTab sheet={sheet} dice={{ roll, mode, setMode, share }} edit={edit} />
          )}
          {problem && <div className="error-text">{problem}</div>}
          {rolls && <RollResults latest={detailTab !== undefined} />}
        </div>
      )}
    </aside>
  );
}
