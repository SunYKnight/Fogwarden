import { useState } from 'react';
import { create } from 'zustand';
import { nowIso } from '@/core/model';
import { countOf } from '@/core/plural';
import { createRandomTable, parseTableFile, formatTableFile, type RandomTable, type TableRoll } from '@/core/tables';
import { MY_CONTENT } from '@/data/packs';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { appendToJournal } from '@/state/journalRecorder';
import { useLibraryStore } from '@/state/libraryStore';
import { rollTable } from '@/state/randomTables';
import { NameDialog } from '../campaign/campaignUi';
import { TextField, useDraft } from '../components/fields';
import { Button, confirmDialog, EmptyState, Icon } from '../kit';
import { activateOnKey } from './listRow';
import { OriginBadge } from './OriginBadge';
import { serialQueue } from './serialQueue';

type Entry = LibraryEntry<'table'>;

const SYNTAX_HINT =
  'One entry per line. "3: text" weighs an entry 3; "1-3: text" and "4: text" are dice ranges ' +
  '(add "dice: 2d6" in a header for other dice). [Table name] rolls on another table, [2d6] rolls dice. ' +
  'Lines starting with # are comments.';
const KEPT_ROLLS = 8;

interface TableUiState {
  selectedId: string | null;
  creating: boolean;
}

// The header action creates a table the list then selects.
const useTableUi = create<TableUiState>(() => ({ selectedId: null, creating: false }));

async function createTable(name: string): Promise<void> {
  const repository = useAppStore.getState().repository;
  const id = await repository.newLibraryId('table', name);
  const stored = await repository.save('table', createRandomTable(id, name, nowIso()));
  await useLibraryStore.getState().refresh('table');
  useTableUi.setState({ selectedId: stored.id });
  useAppStore.getState().notify(`Created "${stored.name}"`, 'success');
}

/** Compendium header actions of the Tables tab. */
export function TableActions() {
  const creating = useTableUi((s) => s.creating);
  return (
    <>
      <Button icon="plus" label="New table" variant="primary" onClick={() => useTableUi.setState({ creating: true })} />
      {creating && (
        <NameDialog
          title="New random table"
          initial=""
          confirmLabel="Create"
          onSubmit={createTable}
          onClose={() => useTableUi.setState({ creating: false })}
        />
      )}
    </>
  );
}

function describe(table: RandomTable): string {
  const count = countOf(table.entries.length, 'entry', 'entries');
  const dice = table.dice ?? `d${table.entries[table.entries.length - 1]?.to ?? 0}`;
  return table.kind === 'dice' ? `${dice} · ${count}` : count;
}

function TableEditor({ entry }: { entry: Entry }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const refresh = useLibraryStore((s) => s.refresh);
  const table = entry.doc;
  // Follows the table when it changes from outside, e.g. after Revert.
  const [text, setText] = useDraft(table.text);
  const [problem, setProblem] = useState<string | null>(null);
  // Edits apply to the newest listed table, so a quick second edit keeps the first.
  const [queue] = useState(serialQueue);

  const save = (change: (latest: RandomTable) => RandomTable) =>
    queue(async () => {
      const latest = useLibraryStore.getState().listings.table.entries.find((e) => e.ref.id === table.id)?.doc;
      await repository.save('table', change(latest ?? table));
      await refresh('table');
    });

  // Checked before saving so a typo never replaces a working table.
  const commitText = () => {
    let parsed: RandomTable | null = null;
    try {
      parsed = parseTableFile(formatTableFile({ ...table, text }), table.id);
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
    if (parsed && text !== table.text) {
      save((latest) => parseTableFile(formatTableFile({ ...latest, text }), latest.id)).catch(reportError);
    }
  };

  return (
    <div className="col table-editor">
      <TextField
        label="Name"
        value={table.name}
        onChange={(name) => save((latest) => ({ ...latest, name })).catch(reportError)}
      />
      <textarea
        className="table-text"
        aria-label={`Entries of ${table.name}`}
        spellCheck={false}
        value={text}
        placeholder={'1-2: A wandering merchant\n3-5: [Bandits]\n6: Nothing but wind'}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
      />
      {problem ? <p className="error-text">{problem} (not saved)</p> : <p className="muted">{SYNTAX_HINT}</p>}
    </div>
  );
}

function RollPanel({ table }: { table: RandomTable }) {
  const reportError = useAppStore((s) => s.reportError);
  const encounter = useEncounterStore((s) => s.encounter);
  const [rolls, setRolls] = useState<TableRoll[]>([]);
  const last = rolls[0];
  const noEncounter = 'Open an encounter in Play first';

  const roll = () => {
    try {
      const result = rollTable(table.id);
      setRolls((r) => [result, ...r].slice(0, KEPT_ROLLS));
    } catch (error) {
      reportError(error);
    }
  };

  const toLog = (result: TableRoll) => {
    useEncounterStore.getState().update((d) => addLog(d, 'roll', `${result.tableName}: ${result.text}`));
    useAppStore.getState().notify('Added to the log', 'success');
  };

  const toJournal = async (result: TableRoll) => {
    const saved = await appendToJournal(encounter!.campaignId, [`${result.tableName}: ${result.text}`], null);
    useAppStore.getState().notify(`Added to "${saved.title}"`, 'success');
  };

  return (
    <div className="col roll-panel">
      <Button icon="dice" label={`Roll on ${table.name}`} onClick={roll} />
      {last && (
        <div className="panel roll-result" aria-live="polite">
          <strong>{last.text}</strong>
          <span className="muted">{last.detail}</span>
          <div className="row">
            <Button
              icon="list"
              label="Add to log"
              disabled={!encounter}
              title={encounter ? `Log of "${encounter.name}"` : noEncounter}
              onClick={() => toLog(last)}
            />
            <Button
              icon="journal"
              label="Add to journal"
              disabled={!encounter}
              title={encounter ? 'Current session of the running encounter\u2019s campaign' : noEncounter}
              onClick={() => toJournal(last).catch(reportError)}
            />
          </div>
        </div>
      )}
      {rolls.slice(1).map((r, i) => (
        <div key={i} className="muted roll-earlier">
          {r.text}
        </div>
      ))}
    </div>
  );
}

/** Random tables: list, roll, edit the entries as text. */
export function TableLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.table);
  const refresh = useLibraryStore((s) => s.refresh);
  const selectedId = useTableUi((s) => s.selectedId);
  const [text, setText] = useState('');
  const selected = listing.entries.find((e) => e.ref.id === selectedId);
  const needle = text.toLowerCase();
  const entries = listing.entries.filter((e) => e.doc.name.toLowerCase().includes(needle));

  const remove = async ({ ref, doc, overrides }: Entry) => {
    const copy = overrides.length > 0;
    const ok = await confirmDialog({
      title: copy ? 'Revert table' : 'Delete table',
      message: copy
        ? `Your copy of "${doc.name}" is deleted and the pack's version comes back.`
        : `"${doc.name}" is deleted.`,
      confirmLabel: copy ? 'Revert' : 'Delete',
      danger: true,
    });
    if (ok) {
      await repository.remove('table', ref.id);
      await refresh('table');
    }
  };

  return (
    <div className="compendium-split">
      <div className="compendium-list">
        <input
          type="search"
          aria-label="Search tables"
          placeholder="Search tables"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="list" role="listbox" aria-label="Random tables">
          {entries.map((entry) => (
            <div
              key={entry.ref.id}
              role="option"
              tabIndex={0}
              aria-selected={entry.ref.id === selectedId}
              className={entry.ref.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => useTableUi.setState({ selectedId: entry.ref.id })}
              onKeyDown={activateOnKey(() => useTableUi.setState({ selectedId: entry.ref.id }))}
            >
              <Icon name="dice" size={14} />
              <span className="row-name">{entry.doc.name}</span>
              <span className="muted">{describe(entry.doc)}</span>
              <OriginBadge entry={entry} />
            </div>
          ))}
        </div>
        {entries.length === 0 && (
          <EmptyState
            icon="dice"
            title={listing.entries.length === 0 ? 'No random tables yet.' : 'No tables match.'}
            action={<Button icon="plus" label="New table" onClick={() => useTableUi.setState({ creating: true })} />}
          >
            Names, loot, encounters, rumours: one entry per line, rolled with one click.
          </EmptyState>
        )}
      </div>
      <div className="creature-preview">
        {selected ? (
          <div className="col" key={selected.ref.id}>
            <div className="row">
              <strong>{selected.doc.name}</strong>
              <div className="spacer" />
              {selected.pack === MY_CONTENT && (
                <Button
                  icon={selected.overrides.length > 0 ? 'undo' : 'trash'}
                  label={selected.overrides.length > 0 ? 'Revert' : 'Delete'}
                  variant="danger"
                  onClick={() => remove(selected).catch(reportError)}
                />
              )}
            </div>
            {selected.pack !== MY_CONTENT && (
              <p className="hint-bar">From pack &quot;{selected.pack}&quot;: changes create your copy.</p>
            )}
            <RollPanel table={selected.doc} />
            <TableEditor entry={selected} />
          </div>
        ) : (
          <EmptyState icon="dice" title="Select a table to roll on it or edit it." />
        )}
      </div>
    </div>
  );
}
