import { useEffect, useState, type ComponentType } from 'react';
import {
  ABILITIES,
  CURRENCIES,
  SHEET_ITEMS_MAX,
  SHEET_VALUE_MAX,
  SKILL_ABILITY,
  SKILLS,
  type CharacterSpell,
  type SheetEdit,
} from '@/core/model';
import { abilityModifier, formatModifier } from '@/core/rules/abilities';
import type { CharacterDetails } from '@/sync/protocol';
import { NotesEditor } from '../campaign/campaignUi';
import { Markdown } from '../components/Markdown';
import { titleCase } from '../creature/StatBlock';
import { Icon, Tabs, type TabSpec } from '../kit';

/**
 * The full character sheet as tabs, shared by the player's sheet panel (with roll buttons) and the DM's Party
 * tab and Compendium > Players (read-only).
 */

/** Sends a d20 roll with what it is for; null where the sheet only shows (the DM's side). */
export type SheetRoll = ((dice: string, label: string) => void) | null;

/** How the player's sheet asks the DM to change play values. */
export interface SheetEditRequests {
  /** Asks for `edit`; `confirmed` is the value the DM's sheet shows, as an edit of the same value. */
  send(edit: SheetEdit, confirmed: SheetEdit): void;
  /** The edit of `confirmed`'s value still waiting for the DM ('approve' mode), else null. */
  waiting<E extends SheetEdit>(confirmed: E): E | null;
}

/** Asks the DM to change play values; null while the campaign does not let the player edit. */
export type SheetEditor = SheetEditRequests | null;

export interface SheetTabProps {
  details: CharacterDetails;
  roll: SheetRoll;
  edit: SheetEditor;
}

/** The character's notes: its player writes them (`onCommit`), the DM reads them (null). */
export interface SheetNotes {
  text: string;
  onCommit: ((text: string) => Promise<unknown>) | null;
}

/** A tab of the full sheet, shown while the sheet content is there, or the notes tab, shown with notes. */
export type SheetTab = TabSpec<string> &
  (
    | {
        kind: 'details';
        Body: ComponentType<SheetTabProps>;
        /** Has roll buttons, so the player's panel shows the roll mode and the last result under it. */
        rolls?: boolean;
      }
    | { kind: 'notes'; Body: ComponentType<{ notes: SheetNotes }> }
  );

/**
 * A whole number a player may change: − and + buttons and the number to type. Typed values are sent on Enter
 * or blur; the DM checks the range again. `waiting`: the value is one the DM has not accepted yet.
 */
export function SheetNumber(props: {
  value: number;
  min: number;
  max: number;
  label: string;
  waiting: boolean;
  onChange: (value: number) => void;
}) {
  const { value, min, max, label, waiting, onChange } = props;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (next: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(next)));
    setDraft(String(clamped));
    if (Number.isFinite(next) && clamped !== value) onChange(clamped);
  };
  return (
    <span className={waiting ? 'sheet-number waiting' : 'sheet-number'} role="group" aria-label={label}>
      <button aria-label={`Less ${label}`} disabled={value <= min} onClick={() => commit(value - 1)}>
        <Icon name="minus" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(Number(draft))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(Number(draft));
        }}
      />
      <button aria-label={`More ${label}`} disabled={value >= max} onClick={() => commit(value + 1)}>
        <Icon name="plus" />
      </button>
      {waiting && <span className="muted small">(waiting for the DM)</span>}
    </span>
  );
}

/**
 * A play value of one number as a `SheetNumber`: the value the player asked for shows until the DM answers for
 * good, so further steps start from it; `confirmed` is the value as the DM's sheet shows it.
 */
export function SheetEditNumber(props: {
  edit: SheetEditRequests;
  confirmed: Extract<SheetEdit, { value: number }>;
  min: number;
  max: number;
  label: string;
}) {
  const { edit, confirmed, min, max, label } = props;
  const waiting = edit.waiting(confirmed);
  return (
    <SheetNumber
      value={(waiting ?? confirmed).value}
      min={min}
      max={max}
      label={label}
      waiting={waiting !== null}
      onChange={(value) => edit.send({ ...confirmed, value }, confirmed)}
    />
  );
}

const STATUS_LABEL: Record<CharacterSpell['status'], string> = {
  known: 'Known',
  prepared: 'Prepared',
  'always-prepared': 'Always prepared',
};
const COIN_LABEL: Record<(typeof CURRENCIES)[number], string> = {
  cp: 'CP',
  sp: 'SP',
  ep: 'EP',
  gp: 'GP',
  pp: 'PP',
};

/** One check: proficiency mark, name, total bonus and, for players, a roll button. */
function CheckRow(props: { label: string; mark: string; bonus: number; roll: SheetRoll; rollLabel: string }) {
  const { label, mark, bonus, roll, rollLabel } = props;
  const modifier = formatModifier(bonus);
  return (
    <li className="sheet-check">
      <span className="sheet-mark" title={mark === '' ? 'Not proficient' : mark}>
        {mark === 'Expertise' ? '●●' : mark === '' ? '○' : '●'}
      </span>
      <span className="grow">{label}</span>
      <strong>{modifier}</strong>
      {roll && (
        <button aria-label={`Roll ${rollLabel} (1d20${modifier})`} onClick={() => roll(`1d20${modifier}`, rollLabel)}>
          <Icon name="dice" />
        </button>
      )}
    </li>
  );
}

function SkillsTab({ details, roll }: SheetTabProps) {
  const { sheet } = details;
  return (
    <div className="sheet-section">
      <div className="sheet-abilities" aria-label="Ability scores">
        {ABILITIES.map((a) => (
          <div key={a} className="sheet-ability">
            <span className="muted small">{a.toUpperCase()}</span>
            <strong>{formatModifier(abilityModifier(sheet.abilities[a]))}</strong>
            <span className="small">{sheet.abilities[a]}</span>
          </div>
        ))}
      </div>
      <span className="muted small">Proficiency bonus {formatModifier(sheet.proficiencyBonus)}</span>
      <h4>Saving throws</h4>
      <ul className="sheet-checks" aria-label="Saving throws">
        {ABILITIES.map((a) => (
          <CheckRow
            key={a}
            label={titleCase(a)}
            mark={sheet.savingThrows[a].proficient ? 'Proficient' : ''}
            bonus={sheet.savingThrows[a].bonus}
            roll={roll}
            rollLabel={`${titleCase(a)} save`}
          />
        ))}
      </ul>
      <h4>Skills</h4>
      <ul className="sheet-checks" aria-label="Skills">
        {SKILLS.map((s) => {
          const { proficiency, bonus } = sheet.skills[s];
          return (
            <CheckRow
              key={s}
              label={`${titleCase(s)} (${titleCase(SKILL_ABILITY[s])})`}
              mark={proficiency === 'none' ? '' : titleCase(proficiency)}
              bonus={bonus}
              roll={roll}
              rollLabel={titleCase(s)}
            />
          );
        })}
      </ul>
    </div>
  );
}

function SpellsTab({ details }: SheetTabProps) {
  const { sheet, spells } = details;
  const levels = [...new Set(sheet.spells.map((s) => s.level))].sort((a, b) => a - b);
  return (
    <div className="sheet-section">
      {sheet.spellcasting.map((c) => (
        <span key={c.source} className="small">
          {c.source}: {c.ability}, save DC <strong>{c.saveDc}</strong>, attack{' '}
          <strong>{formatModifier(c.attackBonus)}</strong>
        </span>
      ))}
      {levels.map((level) => (
        <section key={level} aria-label={level === 0 ? 'Cantrips' : `Level ${level} spells`}>
          <h4>{level === 0 ? 'Cantrips' : `Level ${level}`}</h4>
          {sheet.spells
            .filter((s) => s.level === level)
            .map((s) => {
              const info = s.spell === null ? undefined : spells[s.spell];
              return (
                <details key={`${s.source}:${s.name}`} className="sheet-entry">
                  <summary>
                    <span className="grow">{s.name}</span>
                    {s.level > 0 && <span className="chip">{STATUS_LABEL[s.status]}</span>}
                  </summary>
                  {info ? (
                    <>
                      <p className="muted small">
                        {[info.school, info.castingTime, info.range, info.components, info.duration]
                          .filter((part) => part !== '')
                          .join(' · ')}
                        {info.ritual && ' · ritual'}
                      </p>
                      <Markdown text={info.description} empty="No description." />
                    </>
                  ) : (
                    <p className="muted small">{s.source}. Not in the spell library.</p>
                  )}
                </details>
              );
            })}
        </section>
      ))}
      {sheet.spells.length === 0 && <p className="muted">No spells.</p>}
    </div>
  );
}

/** Equipped switch of an item; a change shows at once and is marked until the DM answers for good. */
function EquippedField({ edit, index, equipped }: { edit: SheetEditRequests; index: number; equipped: boolean }) {
  const confirmed = { field: 'itemEquipped', index, value: equipped } as const;
  const waiting = edit.waiting(confirmed);
  return (
    <label className="chip">
      <input
        type="checkbox"
        checked={(waiting ?? confirmed).value}
        onChange={(e) => edit.send({ ...confirmed, value: e.target.checked }, confirmed)}
      />{' '}
      Equipped{waiting && ' (waiting for the DM)'}
    </label>
  );
}

function InventoryTab({ details, edit }: SheetTabProps) {
  const { currency, inventory } = details.sheet;
  return (
    <div className="sheet-section">
      <div className="row wrap" aria-label="Coins">
        {CURRENCIES.map((c) =>
          edit ? (
            <label key={c} className="sheet-stat">
              <SheetEditNumber
                edit={edit}
                confirmed={{ field: 'currency', coin: c, value: currency[c] }}
                min={0}
                max={SHEET_VALUE_MAX}
                label={COIN_LABEL[c]}
              />{' '}
              {COIN_LABEL[c]}
            </label>
          ) : (
            <span key={c} className="sheet-stat">
              <strong>{currency[c]}</strong> {COIN_LABEL[c]}
            </span>
          ),
        )}
      </div>
      <ul className="sheet-checks" aria-label="Equipment">
        {inventory.map((item, i) => (
          <li key={`${i}:${item.name}`} className="sheet-check">
            {edit && i < SHEET_ITEMS_MAX ? (
              <SheetEditNumber
                edit={edit}
                confirmed={{ field: 'itemQuantity', index: i, value: item.quantity }}
                min={0}
                max={SHEET_VALUE_MAX}
                label={`${item.name} count`}
              />
            ) : (
              <span className="sheet-mark">{item.quantity}×</span>
            )}
            <span className="grow">{item.name}</span>
            {edit && i < SHEET_ITEMS_MAX ? (
              <EquippedField edit={edit} index={i} equipped={item.equipped} />
            ) : (
              item.equipped && <span className="chip">Equipped</span>
            )}
            {item.attuned && <span className="chip">Attuned</span>}
          </li>
        ))}
      </ul>
      {inventory.length === 0 && <p className="muted">No equipment.</p>}
    </div>
  );
}

function FeaturesTab({ details }: SheetTabProps) {
  const { sheet } = details;
  const rows: [string, string][] = [
    ['Race', sheet.race],
    ['Class', sheet.classes],
    ['Background', sheet.background],
    ['Personality', sheet.personality.traits],
    ['Ideals', sheet.personality.ideals],
    ['Bonds', sheet.personality.bonds],
    ['Flaws', sheet.personality.flaws],
    ...Object.entries(sheet.appearance).map(([key, value]): [string, string] => [titleCase(key), value]),
  ];
  const about = rows.filter(([, value]) => value !== '');
  return (
    <div className="sheet-section">
      {about.length > 0 && (
        <dl className="sheet-about">
          {about.map(([label, value]) => (
            <div key={label}>
              <dt className="muted small">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {sheet.features.map((f, i) => (
        <details key={`${i}:${f.name}`} className="sheet-entry">
          <summary>
            <span className="grow">{f.name}</span>
            {f.source !== '' && <span className="muted small">{f.source}</span>}
          </summary>
          <Markdown text={f.text} empty="No description." />
        </details>
      ))}
      {sheet.features.length === 0 && <p className="muted">No features.</p>}
      {sheet.backstory !== '' && (
        <details className="sheet-entry">
          <summary>Backstory</summary>
          <Markdown text={sheet.backstory} empty="" />
        </details>
      )}
    </div>
  );
}

function NotesTab({ notes }: { notes: SheetNotes }) {
  return notes.onCommit ? (
    <div className="sheet-section">
      <p className="muted small">Only you and the DM can read your notes; the DM keeps them with the campaign.</p>
      <NotesEditor
        value={notes.text}
        label="Notes"
        placeholder="Names, clues, debts, plans… (Markdown)"
        onCommit={notes.onCommit}
      />
    </div>
  ) : (
    <div className="sheet-section">
      <Markdown text={notes.text} empty="No notes yet." />
    </div>
  );
}

/** Sheet tabs in display order; a new tab adds one entry here. */
export const SHEET_TABS: SheetTab[] = [
  { id: 'skills', label: 'Skills', kind: 'details', Body: SkillsTab, rolls: true },
  { id: 'spells', label: 'Spells', kind: 'details', Body: SpellsTab },
  { id: 'inventory', label: 'Inventory', kind: 'details', Body: InventoryTab },
  { id: 'features', label: 'Features', kind: 'details', Body: FeaturesTab },
  { id: 'notes', label: 'Notes', kind: 'notes', Body: NotesTab },
];

/** The tabs there is something to show for: sheet tabs with the sheet content, the notes tab with notes. */
export function sheetTabsFor(details: CharacterDetails | null, notes: SheetNotes | null): SheetTab[] {
  return SHEET_TABS.filter((t) => (t.kind === 'details' ? details !== null : notes !== null));
}

/** One tab's content; `details` and `notes` are those `sheetTabsFor` was given. */
export function SheetTabBody(props: {
  tab: SheetTab;
  details: CharacterDetails | null;
  notes: SheetNotes | null;
  roll: SheetRoll;
  edit: SheetEditor;
}) {
  const { tab, details, notes, roll, edit } = props;
  return tab.kind === 'notes'
    ? notes && <tab.Body notes={notes} />
    : details && <tab.Body details={details} roll={roll} edit={edit} />;
}

/**
 * The sheet as the DM reads it: the same tabs as the player's, without rolls or edits; with `notes`, the
 * player's notes too.
 */
export function CharacterSheetView({ details, notes }: { details: CharacterDetails; notes?: SheetNotes | null }) {
  const tabs = sheetTabsFor(details, notes ?? null);
  const [tab, setTab] = useState(tabs[0]!.id);
  const shown = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  return (
    <div className="character-sheet">
      <Tabs tabs={tabs} value={shown.id} onChange={setTab} label="Character sheet" />
      <SheetTabBody tab={shown} details={details} notes={notes ?? null} roll={null} edit={null} />
    </div>
  );
}
