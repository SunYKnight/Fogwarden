import { useMemo, useState } from 'react';
import { CREATURE_TYPES, createCreature, newId, nowIso, type Creature, type DocRef } from '@/core/model';
import { formatCr } from '@/core/rules/abilities';
import { parseStatBlock, StatBlockError } from '@/core/import/statblock';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CreatureEditor } from '../creature/CreatureEditor';
import { StatBlock } from '../creature/StatBlock';
import { TextField } from '../components/fields';
import { confirmDialog } from '../kit';

type SortKey = 'name' | 'cr' | 'type';

const SORTERS: Record<SortKey, (a: Creature, b: Creature) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  cr: (a, b) => a.challenge - b.challenge || a.name.localeCompare(b.name),
  type: (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
};

const CR_OPTIONS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];

interface Filter {
  text: string;
  type: string;
  source: string;
  tag: string;
  minCr: number;
  maxCr: number;
}

const NO_FILTER: Filter = { text: '', type: '', source: '', tag: '', minCr: 0, maxCr: 30 };

function matches(c: Creature, f: Filter): boolean {
  const tag = f.tag.toLowerCase();
  return (
    c.name.toLowerCase().includes(f.text.toLowerCase()) &&
    (f.type === '' || c.type === f.type) &&
    (f.source === '' || c.source === f.source) &&
    (tag === '' || c.tags.some((t) => t.toLowerCase().includes(tag))) &&
    c.challenge >= f.minCr &&
    c.challenge <= f.maxCr
  );
}

function originLabel(entry: LibraryEntry<'creature'>): string {
  return entry.ref.area === 'content' ? 'shipped' : entry.overridesContent ? 'edited copy' : 'user';
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (c: Creature) => void }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const refresh = useLibraryStore((s) => s.refresh);
  const [text, setText] = useState('');
  const [source, setSource] = useState('Custom');
  const [license, setLicense] = useState('');
  const [parsed, setParsed] = useState<Creature | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A stat block that doesn't parse is a user input problem shown in place.
  const parse = () => {
    try {
      setParsed(parseStatBlock(text, { source, license }));
      setProblem(null);
    } catch (error) {
      setParsed(null);
      setProblem(error instanceof StatBlockError ? error.message : null);
      if (!(error instanceof StatBlockError)) reportError(error);
    }
  };

  const save = async (creature: Creature) => {
    const stored = await repository.save('creature', creature);
    await refresh('creature');
    onImported(stored);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal import-dialog">
        <div className="topbar">
          <strong>Import creature from stat block text</strong>
          <div className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
        <div className="import-body">
          <div className="col">
            <textarea
              rows={24}
              value={text}
              placeholder="Paste a stat block (name, size/type line, Armor Class, Hit Points, …)"
              onChange={(e) => setText(e.target.value)}
            />
            <TextField label="Source" value={source} onChange={setSource} />
            <TextField label="License" value={license} onChange={setLicense} />
            <div className="row">
              <button disabled={text.trim() === ''} onClick={parse}>
                Parse
              </button>
              <button className="primary" disabled={!parsed} onClick={() => parsed && save(parsed).catch(reportError)}>
                Save and edit
              </button>
            </div>
            {problem && <div className="error-text">{problem}</div>}
          </div>
          <div className="creature-preview">{parsed && <StatBlock creature={parsed} />}</div>
        </div>
      </div>
    </div>
  );
}

function FilterBar({
  filter,
  setFilter,
  sources,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  sources: string[];
}) {
  return (
    <div className="row wrap">
      <input placeholder="Name" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
      <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
        <option value="">All types</option>
        {CREATURE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <span className="muted">CR</span>
      {(['minCr', 'maxCr'] as const).map((key) => (
        <select key={key} value={filter[key]} onChange={(e) => setFilter({ ...filter, [key]: Number(e.target.value) })}>
          {CR_OPTIONS.map((cr) => (
            <option key={cr} value={cr}>
              {formatCr(cr)}
            </option>
          ))}
        </select>
      ))}
      <select value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
        <option value="">All sources</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input placeholder="Tag" value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })} />
      <button onClick={() => setFilter(NO_FILTER)}>Reset</button>
    </div>
  );
}

export function CreatureLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.creature);
  const refresh = useLibraryStore((s) => s.refresh);
  const [filter, setFilter] = useState(NO_FILTER);
  const [sort, setSort] = useState<SortKey>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Creature | null>(null);
  const [importing, setImporting] = useState(false);

  const sources = useMemo(() => [...new Set(listing.entries.map((e) => e.doc.source))].sort(), [listing]);
  const entries = useMemo(
    () => listing.entries.filter((e) => matches(e.doc, filter)).sort((a, b) => SORTERS[sort](a.doc, b.doc)),
    [listing, filter, sort],
  );
  const selected = listing.entries.find((e) => e.ref.id === selectedId)?.doc ?? null;

  const duplicate = async (creature: Creature) => {
    const at = nowIso();
    const copy = { ...creature, id: newId(), name: `${creature.name} copy`, createdAt: at, updatedAt: at };
    const stored = await repository.save('creature', copy);
    await refresh('creature');
    setSelectedId(stored.id);
  };

  const remove = async (ref: DocRef, creature: Creature, overridesContent: boolean) => {
    const ok = await confirmDialog(
      overridesContent
        ? {
            title: 'Restore shipped creature',
            message: `Your edits of "${creature.name}" are discarded and the shipped version comes back.`,
            confirmLabel: 'Restore',
          }
        : {
            title: 'Delete creature',
            message: `"${creature.name}" is removed from your compendium.`,
            confirmLabel: 'Delete creature',
            danger: true,
          },
    );
    if (ok) {
      await repository.remove('creature', ref.id);
      await refresh('creature');
    }
  };

  return (
    <div className="library-split">
      <div className="col">
        <div className="row">
          <button className="primary" onClick={() => setEditing(createCreature('New creature'))}>
            New
          </button>
          <button onClick={() => setImporting(true)}>Import from text…</button>
          <div className="spacer" />
          <span className="muted">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="cr">Challenge</option>
            <option value="type">Type</option>
          </select>
        </div>
        <FilterBar filter={filter} setFilter={setFilter} sources={sources} />
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>CR</th>
              <th>Type</th>
              <th>Source</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const { ref, doc, overridesContent } = entry;
              return (
                <tr
                  key={`${ref.area}:${ref.id}`}
                  className={ref.id === selectedId ? 'selected' : ''}
                  onClick={() => setSelectedId(ref.id)}
                >
                  <td>{doc.name}</td>
                  <td>{formatCr(doc.challenge)}</td>
                  <td>
                    {doc.size} {doc.type}
                  </td>
                  <td>{doc.source}</td>
                  <td>
                    <span className={`badge ${ref.area}`}>{originLabel(entry)}</span>
                  </td>
                  <td className="row" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setEditing(doc)}>Edit</button>
                    <button onClick={() => duplicate(doc).catch(reportError)}>Duplicate</button>
                    {ref.area === 'data' && (
                      <button className="danger" onClick={() => remove(ref, doc, overridesContent).catch(reportError)}>
                        {overridesContent ? 'Revert' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {entries.length === 0 && <p className="muted">No creatures match.</p>}
      </div>
      <div className="creature-preview">{selected && <StatBlock creature={selected} />}</div>
      {editing && <CreatureEditor creature={editing} onClose={() => setEditing(null)} />}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={(c) => {
            setImporting(false);
            setSelectedId(c.id);
            setEditing(c);
          }}
        />
      )}
    </div>
  );
}
