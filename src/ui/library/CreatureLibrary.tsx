import { useMemo, useState, type MouseEvent } from 'react';
import { CREATURE_TYPES, nowIso, type Creature } from '@/core/model';
import { formatCr } from '@/core/rules/abilities';
import { MY_CONTENT } from '@/data/packs';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { packName, useLibraryStore } from '@/state/libraryStore';
import { CreatureThumb } from '../creatureTypes/CreatureThumb';
import { StatBlock } from '../creature/StatBlock';
import { Button, confirmDialog, EmptyState, openContextMenu, type MenuItem } from '../kit';
import { openCreatureImport } from './compendiumUi';
import { OriginBadge } from './OriginBadge';

type SortKey = 'name' | 'cr' | 'type';
type Entry = LibraryEntry<'creature'>;

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
  minCr: number;
  maxCr: number;
  mineOnly: boolean;
}

const NO_FILTER: Filter = { text: '', type: '', source: '', minCr: 0, maxCr: 30, mineOnly: false };

// Free text also searches tags so the old tag filter needs no own field.
function matches(entry: Entry, f: Filter): boolean {
  const c = entry.doc;
  const text = f.text.toLowerCase();
  return (
    (c.name.toLowerCase().includes(text) || c.tags.some((t) => t.toLowerCase().includes(text))) &&
    (f.type === '' || c.type === f.type) &&
    (f.source === '' || c.source === f.source) &&
    (!f.mineOnly || entry.pack === MY_CONTENT) &&
    c.challenge >= f.minCr &&
    c.challenge <= f.maxCr
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
    <div className="row wrap compendium-filters">
      <input
        type="search"
        aria-label="Search name or tag"
        placeholder="Search name or tag"
        value={filter.text}
        onChange={(e) => setFilter({ ...filter, text: e.target.value })}
      />
      <select aria-label="Type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
        <option value="">All types</option>
        {CREATURE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <span className="muted">CR</span>
      {(['minCr', 'maxCr'] as const).map((key) => (
        <select
          key={key}
          aria-label={key === 'minCr' ? 'Minimum CR' : 'Maximum CR'}
          value={filter[key]}
          onChange={(e) => setFilter({ ...filter, [key]: Number(e.target.value) })}
        >
          {CR_OPTIONS.map((cr) => (
            <option key={cr} value={cr}>
              {formatCr(cr)}
            </option>
          ))}
        </select>
      ))}
      <select
        aria-label="Source"
        value={filter.source}
        onChange={(e) => setFilter({ ...filter, source: e.target.value })}
      >
        <option value="">All sources</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label className="row">
        <input
          type="checkbox"
          checked={filter.mineOnly}
          onChange={(e) => setFilter({ ...filter, mineOnly: e.target.checked })}
        />
        Mine only
      </label>
      <Button label="Reset" variant="ghost" onClick={() => setFilter(NO_FILTER)} />
    </div>
  );
}

export function CreatureLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useAppStore((s) => s.navigate);
  const listing = useLibraryStore((s) => s.listings.creature);
  const refresh = useLibraryStore((s) => s.refresh);
  const [filter, setFilter] = useState(NO_FILTER);
  const [sort, setSort] = useState<SortKey>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sources = useMemo(() => [...new Set(listing.entries.map((e) => e.doc.source))].sort(), [listing]);
  const entries = useMemo(
    () => listing.entries.filter((e) => matches(e, filter)).sort((a, b) => SORTERS[sort](a.doc, b.doc)),
    [listing, filter, sort],
  );
  const selected = listing.entries.find((e) => e.ref.id === selectedId) ?? null;

  const edit = (entry: Entry) => navigate({ page: 'creature-editor', ref: entry.ref });

  const duplicate = async (creature: Creature) => {
    const at = nowIso();
    const name = `${creature.name} copy`;
    const id = await repository.newLibraryId('creature', name);
    const copy = { ...creature, id, name, createdAt: at, updatedAt: at };
    const stored = await repository.save('creature', copy);
    await refresh('creature');
    setSelectedId(stored.id);
    useAppStore.getState().notify(`Created "${stored.name}"`);
  };

  const remove = async ({ ref, doc, overrides }: Entry) => {
    const original = overrides[0] && packName(useLibraryStore.getState().packs, overrides[0]);
    const ok = await confirmDialog(
      original
        ? {
            title: 'Revert to pack version',
            message: `Your copy of "${doc.name}" is deleted and the version from "${original}" comes back.`,
            confirmLabel: 'Revert',
            danger: true,
          }
        : {
            title: 'Delete creature',
            message: `"${doc.name}" is removed from your compendium.`,
            confirmLabel: 'Delete creature',
            danger: true,
          },
    );
    if (ok) {
      await repository.remove('creature', ref.id);
      await refresh('creature');
    }
  };

  const menuItems = (entry: Entry): MenuItem[] => [
    { label: 'Edit', icon: 'edit', run: () => edit(entry) },
    { label: 'Duplicate', icon: 'copy', run: () => duplicate(entry.doc).catch(reportError) },
    {
      label: entry.overrides.length > 0 ? 'Revert to pack version' : 'Delete',
      icon: entry.overrides.length > 0 ? 'undo' : 'trash',
      danger: true,
      disabled: entry.pack !== MY_CONTENT,
      run: () => remove(entry).catch(reportError),
    },
  ];

  const showMenu = (e: MouseEvent, entry: Entry) => {
    e.preventDefault();
    setSelectedId(entry.ref.id);
    openContextMenu(e.clientX, e.clientY, menuItems(entry));
  };

  return (
    <div className="compendium-split">
      <div className="compendium-list">
        <FilterBar filter={filter} setFilter={setFilter} sources={sources} />
        <div className="row">
          <span className="muted">
            {entries.length} of {listing.entries.length}
          </span>
          <div className="spacer" />
          <label className="row">
            <span className="muted">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="name">Name</option>
              <option value="cr">Challenge</option>
              <option value="type">Type</option>
            </select>
          </label>
        </div>
        <div className="list" role="listbox" aria-label="Creatures">
          {entries.map((entry) => (
            <div
              key={`${entry.ref.area}:${entry.ref.id}`}
              role="option"
              tabIndex={0}
              aria-selected={entry.ref.id === selectedId}
              className={entry.ref.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => setSelectedId(entry.ref.id)}
              onDoubleClick={() => edit(entry)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') edit(entry);
              }}
              onContextMenu={(e) => showMenu(e, entry)}
            >
              <CreatureThumb creature={entry.doc} className="creature-row-thumb" />
              <span className="row-name">{entry.doc.name}</span>
              <span className="row-cr">CR {formatCr(entry.doc.challenge)}</span>
              <span className="muted row-type">{entry.doc.type}</span>
              <OriginBadge entry={entry} />
            </div>
          ))}
        </div>
        {entries.length === 0 && (
          <EmptyState
            icon="search"
            title={listing.entries.length === 0 ? 'No creatures yet.' : 'No creatures match the filters.'}
            action={
              listing.entries.length === 0 ? (
                <Button
                  icon="upload"
                  label="Import from text"
                  variant="primary"
                  onClick={() => openCreatureImport('')}
                />
              ) : (
                <Button label="Reset filters" onClick={() => setFilter(NO_FILTER)} />
              )
            }
          />
        )}
      </div>
      <div className="creature-preview">
        {selected ? (
          <>
            <div className="row">
              <OriginBadge entry={selected} />
              <div className="spacer" />
              <Button icon="edit" label="Edit" variant="primary" onClick={() => edit(selected)} />
              <Button icon="copy" label="Duplicate" onClick={() => duplicate(selected.doc).catch(reportError)} />
              {selected.pack === MY_CONTENT && (
                <Button
                  icon={selected.overrides.length > 0 ? 'undo' : 'trash'}
                  label={selected.overrides.length > 0 ? 'Revert' : 'Delete'}
                  variant="danger"
                  onClick={() => remove(selected).catch(reportError)}
                />
              )}
            </div>
            <CreatureThumb
              creature={selected.doc}
              alt={`Portrait of ${selected.doc.name}`}
              className="creature-portrait"
            />
            <StatBlock creature={selected.doc} />
          </>
        ) : (
          <EmptyState icon="book" title="Select a creature to see its stat block." />
        )}
      </div>
    </div>
  );
}
