import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { CREATURE_TYPES, nowIso, type Creature } from '@/core/model';
import { countOf } from '@/core/plural';
import { formatCr } from '@/core/rules/abilities';
import { DND5E_API_PACK } from '@/data/dnd5eApiImport';
import { MY_CONTENT } from '@/data/packs';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { packName, useLibraryStore } from '@/state/libraryStore';
import { CreatureThumb } from '../creatureTypes/CreatureThumb';
import { StatBlock } from '../creature/StatBlock';
import { Button, confirmDialog, EmptyState, openContextMenu, type MenuItem } from '../kit';
import { attachPortraitsFromApi } from './AttachPortraitsDialog';
import { openCreatureImport, openDndApiImport } from './compendiumUi';
import { FilterRow, FilterSelect, type FilterChip } from './FilterRow';
import { OriginBadge } from './OriginBadge';
import { distinct } from './ItemSpellLibrary';

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

// Free text also searches tags, so tags need no field of their own.
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

/** Chips for the set filters; the free text stays in the search box. */
function filterChips(filter: Filter, setFilter: (f: Filter) => void): FilterChip[] {
  const crSet = filter.minCr !== NO_FILTER.minCr || filter.maxCr !== NO_FILTER.maxCr;
  const chips: (FilterChip | false)[] = [
    filter.type !== '' && { label: `Type: ${filter.type}`, clear: () => setFilter({ ...filter, type: '' }) },
    crSet && {
      label: `CR ${formatCr(filter.minCr)}–${formatCr(filter.maxCr)}`,
      clear: () => setFilter({ ...filter, minCr: NO_FILTER.minCr, maxCr: NO_FILTER.maxCr }),
    },
    filter.source !== '' && { label: `Source: ${filter.source}`, clear: () => setFilter({ ...filter, source: '' }) },
    filter.mineOnly && { label: 'Mine only', clear: () => setFilter({ ...filter, mineOnly: false }) },
  ];
  return chips.filter((c) => c !== false);
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
    <FilterRow
      search={{ label: 'Search name or tag', value: filter.text, onChange: (text) => setFilter({ ...filter, text }) }}
      chips={filterChips(filter, setFilter)}
      reset={() => setFilter(NO_FILTER)}
    >
      <FilterSelect
        label="Type"
        all="All types"
        value={filter.type}
        options={[...CREATURE_TYPES]}
        onChange={(type) => setFilter({ ...filter, type })}
      />
      <div className="filter-field">
        <span className="muted">CR</span>
        <div className="row">
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
        </div>
      </div>
      <FilterSelect
        label="Source"
        all="All sources"
        value={filter.source}
        options={sources}
        onChange={(source) => setFilter({ ...filter, source })}
      />
      <label className="row">
        <input
          type="checkbox"
          checked={filter.mineOnly}
          onChange={(e) => setFilter({ ...filter, mineOnly: e.target.checked })}
        />
        Mine only
      </label>
    </FilterRow>
  );
}

export interface CreatureActions {
  edit(entry: Entry): void;
  duplicate(creature: Creature): Promise<void>;
  /** Deletes a My content creature or reverts an override, after asking. */
  remove(entry: Entry): Promise<void>;
  menuItems(entry: Entry): MenuItem[];
}

/** Edit, duplicate and delete or revert of library creatures; `select` shows a new duplicate. */
export function useCreatureActions(select: (id: string) => void): CreatureActions {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useAppStore((s) => s.navigate);
  const refresh = useLibraryStore((s) => s.refresh);

  const edit = (entry: Entry) => navigate({ page: 'creature-editor', ref: entry.ref });

  const duplicate = async (creature: Creature) => {
    const at = nowIso();
    const name = `${creature.name} copy`;
    const id = await repository.newLibraryId('creature', name);
    const copy = { ...creature, id, name, createdAt: at, updatedAt: at };
    const stored = await repository.save('creature', copy);
    await refresh('creature');
    select(stored.id);
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

  return { edit, duplicate, remove, menuItems };
}

/** A selected creature: origin, Edit, Duplicate, Delete or Revert, portrait, `children`, stat block. */
export function CreaturePreview(props: { entry: Entry; actions: CreatureActions; children?: ReactNode }) {
  const { entry, actions, children } = props;
  const reportError = useAppStore((s) => s.reportError);
  return (
    <>
      <div className="row">
        <OriginBadge entry={entry} />
        <div className="spacer" />
        <Button icon="edit" label="Edit" onClick={() => actions.edit(entry)} />
        <Button icon="copy" label="Duplicate" onClick={() => actions.duplicate(entry.doc).catch(reportError)} />
        {entry.pack === MY_CONTENT && (
          <Button
            icon={entry.overrides.length > 0 ? 'undo' : 'trash'}
            label={entry.overrides.length > 0 ? 'Revert' : 'Delete'}
            variant="danger"
            onClick={() => actions.remove(entry).catch(reportError)}
          />
        )}
      </div>
      <CreatureThumb creature={entry.doc} alt={`Portrait of ${entry.doc.name}`} className="creature-portrait" />
      {children}
      <StatBlock creature={entry.doc} />
    </>
  );
}

export function CreatureLibrary() {
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.creature);
  const [filter, setFilter] = useState(NO_FILTER);
  const [sort, setSort] = useState<SortKey>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const actions = useCreatureActions(setSelectedId);
  const { edit, menuItems } = actions;
  // Player characters have their own tab.
  const creatures = useMemo(() => listing.listed.filter((e) => e.doc.kind !== 'player'), [listing]);

  const sources = useMemo(() => distinct(creatures.map((e) => e.doc.source)), [creatures]);
  const entries = useMemo(
    () => creatures.filter((e) => matches(e, filter)).sort((a, b) => SORTERS[sort](a.doc, b.doc)),
    [creatures, filter, sort],
  );
  const selected = creatures.find((e) => e.ref.id === selectedId) ?? null;
  const monsters = useMemo(() => creatures.filter((e) => e.doc.kind === 'monster').length, [creatures]);
  // The D&D 5e API only has pictures of its own monsters.
  const unpictured = useMemo(
    () => creatures.filter((e) => e.pack === DND5E_API_PACK.id && !e.doc.image).length,
    [creatures],
  );

  const showMenu = (e: MouseEvent, entry: Entry) => {
    e.preventDefault();
    setSelectedId(entry.ref.id);
    openContextMenu(e.clientX, e.clientY, menuItems(entry));
  };

  return (
    <div className="compendium-split">
      <div className="compendium-list">
        <FilterBar filter={filter} setFilter={setFilter} sources={sources} />
        {monsters === 0 && creatures.length > 0 && (
          <div className="row">
            <span className="muted grow">No monsters yet.</span>
            <Button icon="download" label="Import from the D&D 5e API…" variant="ghost" onClick={openDndApiImport} />
          </div>
        )}
        {unpictured > 0 && (
          <div className="row">
            <span className="muted grow">
              {countOf(unpictured, 'SRD monster')} {unpictured === 1 ? 'has' : 'have'} no picture.
            </span>
            <Button
              icon="download"
              label="Download pictures…"
              variant="ghost"
              onClick={() => attachPortraitsFromApi().catch(reportError)}
            />
          </div>
        )}
        <div className="row">
          <span className="muted">
            {entries.length} of {creatures.length}
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
                if (e.key === ' ') {
                  // Space would otherwise scroll the list.
                  e.preventDefault();
                  setSelectedId(entry.ref.id);
                }
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
            icon={creatures.length === 0 ? 'users' : 'search'}
            title={creatures.length === 0 ? 'No creatures yet.' : 'No creatures match the filters.'}
            action={
              creatures.length === 0 ? (
                <>
                  <Button icon="download" label="Import from the D&D 5e API…" onClick={openDndApiImport} />
                  <Button icon="upload" label="Stat block from text…" onClick={() => openCreatureImport('')} />
                </>
              ) : (
                <Button label="Reset filters" onClick={() => setFilter(NO_FILTER)} />
              )
            }
          >
            {creatures.length === 0 && 'The app ships no monsters: import the SRD 5.1 ones from the D&D 5e API.'}
          </EmptyState>
        )}
      </div>
      <div className="creature-preview">
        {selected ? (
          <CreaturePreview entry={selected} actions={actions} />
        ) : (
          <EmptyState icon="book" title="Select a creature to see its stat block." />
        )}
      </div>
    </div>
  );
}
