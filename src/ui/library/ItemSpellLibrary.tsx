import { useState, type ReactNode } from 'react';
import { itemSubtitle, type Item } from '@/core/items';
import { spellSubtitle } from '@/core/spells';
import type { LibraryDocs, LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Markdown } from '../components/Markdown';
import { Button, EmptyState, type IconName } from '../kit';
import { openAuroraImport } from './compendiumUi';
import { FilterRow, FilterSelect, type FilterChip } from './FilterRow';
import { OriginBadge } from './OriginBadge';
import { SplitButton } from './SplitButton';

/** Rows rendered at once; more need a narrower search, so typing stays quick with thousands of entries. */
const MAX_ROWS = 300;
const MUNDANE = '(mundane)';

function distinct(values: string[]): string[] {
  return [...new Set(values.filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b));
}

/** Compendium header actions of the Items and Spells tabs: both only come from imports and packs. */
export function ReferenceActions() {
  const navigate = useAppStore((s) => s.navigate);
  return (
    <SplitButton
      icon="upload"
      label="Import from Aurora Builder…"
      onClick={openAuroraImport}
      menuLabel="More ways to add content"
      items={[
        {
          label: 'Manage content packs…',
          icon: 'package',
          run: () => navigate({ page: 'settings', section: 'content' }),
        },
      ]}
    />
  );
}

/** Chip for a select filter that is set; `clear` resets it to "any". */
function selectChip(value: string, label: string, clear: () => void): FilterChip[] {
  return value === '' ? [] : [{ label, clear }];
}

interface SplitProps<K extends 'item' | 'spell'> {
  icon: IconName;
  noun: string;
  total: number;
  entries: LibraryEntry<K>[];
  search: { label: string; value: string; onChange: (text: string) => void };
  chips: FilterChip[];
  /** Fields of the Filters popover. */
  filters: ReactNode;
  reset: () => void;
  describe: (doc: LibraryDocs[K]) => string;
  facts: (doc: LibraryDocs[K]) => [string, string][];
}

/** List left (filters, rows), preview right (name, subtitle, facts, description). */
function ReferenceSplit<K extends 'item' | 'spell'>(props: SplitProps<K>) {
  const { icon, noun, total, entries, search, chips, filters, reset, describe, facts } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((e) => e.ref.id === selectedId);
  const doc = selected?.doc;
  return (
    <div className="compendium-split">
      <div className="compendium-list">
        <FilterRow search={search} chips={chips} reset={reset}>
          {filters}
        </FilterRow>
        <span className="muted">
          {entries.length} of {total}
          {entries.length > MAX_ROWS && `, showing ${MAX_ROWS}: refine the search`}
        </span>
        <div className="list" role="listbox" aria-label={`${noun}s`}>
          {entries.slice(0, MAX_ROWS).map((entry) => (
            <div
              key={entry.ref.id}
              role="option"
              tabIndex={0}
              aria-selected={entry.ref.id === selectedId}
              className={entry.ref.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => setSelectedId(entry.ref.id)}
            >
              <span className="row-name">{entry.doc.name}</span>
              <span className="muted row-detail" title={describe(entry.doc)}>
                {describe(entry.doc)}
              </span>
              <span className="muted row-source" title={entry.doc.source}>
                {entry.doc.source || 'No source'}
              </span>
            </div>
          ))}
        </div>
        {entries.length === 0 && (
          <EmptyState
            icon={icon}
            title={total === 0 ? `No ${noun}s yet.` : `No ${noun}s match the filters.`}
            action={
              total === 0 ? (
                <Button
                  icon="upload"
                  label="Import from Aurora Builder…"
                  variant="primary"
                  onClick={openAuroraImport}
                />
              ) : (
                <Button label="Reset filters" onClick={reset} />
              )
            }
          >
            {total === 0 && `${noun[0]!.toUpperCase()}${noun.slice(1)}s come from packs or files in your library.`}
          </EmptyState>
        )}
      </div>
      <div className="creature-preview">
        {selected && doc ? (
          <div className="col" key={selected.ref.id}>
            <div className="row">
              <strong className="grow">{doc.name}</strong>
              <OriginBadge entry={selected} />
            </div>
            <em className="muted">{describe(doc)}</em>
            <dl className="reference-facts">
              {facts(doc)
                .filter(([, value]) => value !== '')
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            <Markdown text={doc.description} empty="No description." />
          </div>
        ) : (
          <EmptyState icon={icon} title={`Select a ${noun} to read it.`} />
        )}
      </div>
    </div>
  );
}

const NO_ITEM_FILTER = { text: '', type: '', rarity: '', source: '' };
const formatRarity = (r: string) => (r === MUNDANE ? 'Mundane' : r);

/** "Weapon (martial melee)" → "Weapon": the filter groups by the part before details. */
function itemKind(item: Item): string {
  return item.type.replace(/\s*\(.*$/, '');
}

/** Compendium tab Items: mundane and magic items with search, type and rarity filters. */
export function ItemLibrary() {
  const listing = useLibraryStore((s) => s.listings.item);
  const [filter, setFilter] = useState(NO_ITEM_FILTER);
  const needle = filter.text.toLowerCase();
  const entries = listing.entries.filter(
    ({ doc }) =>
      doc.name.toLowerCase().includes(needle) &&
      (filter.type === '' || itemKind(doc) === filter.type) &&
      (filter.rarity === '' || (doc.rarity || MUNDANE) === filter.rarity) &&
      (filter.source === '' || doc.source === filter.source),
  );
  const docs = listing.entries.map((e) => e.doc);
  return (
    <ReferenceSplit<'item'>
      icon="shield"
      noun="item"
      total={listing.entries.length}
      entries={entries}
      search={{ label: 'Search items', value: filter.text, onChange: (text) => setFilter({ ...filter, text }) }}
      chips={[
        ...selectChip(filter.type, `Type: ${filter.type}`, () => setFilter({ ...filter, type: '' })),
        ...selectChip(filter.rarity, `Rarity: ${formatRarity(filter.rarity)}`, () =>
          setFilter({ ...filter, rarity: '' }),
        ),
        ...selectChip(filter.source, `Source: ${filter.source}`, () => setFilter({ ...filter, source: '' })),
      ]}
      reset={() => setFilter(NO_ITEM_FILTER)}
      describe={itemSubtitle}
      facts={(item) => [
        ['Cost', item.cost],
        ['Weight', item.weight],
        ['Source', item.source],
      ]}
      filters={
        <>
          <FilterSelect
            label="Type"
            all="All types"
            value={filter.type}
            options={distinct(docs.map(itemKind))}
            onChange={(type) => setFilter({ ...filter, type })}
          />
          <FilterSelect
            label="Rarity"
            all="All rarities"
            value={filter.rarity}
            options={[MUNDANE, ...distinct(docs.map((d) => d.rarity))]}
            format={formatRarity}
            onChange={(rarity) => setFilter({ ...filter, rarity })}
          />
          <FilterSelect
            label="Source"
            all="All sources"
            value={filter.source}
            options={distinct(docs.map((d) => d.source))}
            onChange={(source) => setFilter({ ...filter, source })}
          />
        </>
      }
    />
  );
}

const NO_SPELL_FILTER = { text: '', level: '', school: '', className: '', source: '' };
const formatLevel = (l: string) => (l === '0' ? 'Cantrip' : `Level ${l}`);

/** Compendium tab Spells: search with level, school and class filters. */
export function SpellLibrary() {
  const listing = useLibraryStore((s) => s.listings.spell);
  const [filter, setFilter] = useState(NO_SPELL_FILTER);
  const needle = filter.text.toLowerCase();
  const entries = listing.entries.filter(
    ({ doc }) =>
      doc.name.toLowerCase().includes(needle) &&
      (filter.level === '' || String(doc.level) === filter.level) &&
      (filter.school === '' || doc.school === filter.school) &&
      (filter.className === '' || doc.classes.includes(filter.className)) &&
      (filter.source === '' || doc.source === filter.source),
  );
  const docs = listing.entries.map((e) => e.doc);
  return (
    <ReferenceSplit<'spell'>
      icon="book"
      noun="spell"
      total={listing.entries.length}
      entries={entries}
      search={{ label: 'Search spells', value: filter.text, onChange: (text) => setFilter({ ...filter, text }) }}
      chips={[
        ...selectChip(filter.level, formatLevel(filter.level), () => setFilter({ ...filter, level: '' })),
        ...selectChip(filter.school, `School: ${filter.school}`, () => setFilter({ ...filter, school: '' })),
        ...selectChip(filter.className, `Class: ${filter.className}`, () => setFilter({ ...filter, className: '' })),
        ...selectChip(filter.source, `Source: ${filter.source}`, () => setFilter({ ...filter, source: '' })),
      ]}
      reset={() => setFilter(NO_SPELL_FILTER)}
      describe={spellSubtitle}
      facts={(spell) => [
        ['Casting time', spell.castingTime],
        ['Range', spell.range],
        ['Components', spell.components],
        ['Duration', spell.duration],
        ['Classes', spell.classes.join(', ')],
        ['Source', spell.source],
      ]}
      filters={
        <>
          <FilterSelect
            label="Level"
            all="All levels"
            value={filter.level}
            options={['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']}
            format={formatLevel}
            onChange={(level) => setFilter({ ...filter, level })}
          />
          <FilterSelect
            label="School"
            all="All schools"
            value={filter.school}
            options={distinct(docs.map((d) => d.school))}
            onChange={(school) => setFilter({ ...filter, school })}
          />
          <FilterSelect
            label="Class"
            all="All classes"
            value={filter.className}
            options={distinct(docs.flatMap((d) => d.classes))}
            onChange={(className) => setFilter({ ...filter, className })}
          />
          <FilterSelect
            label="Source"
            all="All sources"
            value={filter.source}
            options={distinct(docs.map((d) => d.source))}
            onChange={(source) => setFilter({ ...filter, source })}
          />
        </>
      }
    />
  );
}
