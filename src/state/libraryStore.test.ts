import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCreature,
  createMap,
  createMarkerTemplate,
  defaultPackSettings,
  type Creature,
  type MarkerTemplate,
} from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import { MY_CONTENT, packManifestSchema } from '@/data/packs';
import { Repository, type LibraryEntry } from '@/data/repository';
import { useAppStore } from './appStore';
import { useLibraryStore, withDuplicates } from './libraryStore';

const ORDER = [MY_CONTENT, 'aurora', 'api'];

function entry(pack: string, id: string, name: string, kind: Creature['kind'] = 'monster'): LibraryEntry<'creature'> {
  return { ref: { area: 'data', id }, doc: { ...createCreature(name), id, kind }, pack, overrides: [] };
}

function listingOf(entries: LibraryEntry<'creature'>[]) {
  return { entries, problems: [], shadowed: [], unavailable: [] };
}

const ids = (entries: { ref: { id: string } }[]) => entries.map((e) => e.ref.id);

describe('name duplicates', () => {
  const entries = [
    entry('api', 'srd-goblin', 'Goblin'),
    entry('aurora', 'mm-goblin', 'goblin'),
    entry('aurora', 'vgm-goblin', 'Goblin'),
    entry('api', 'srd-hobgoblin', 'Hobgoblin'),
    entry('api', 'srd-orc', 'Orc'),
    entry(MY_CONTENT, 'my-orc', 'Orc!'),
    entry('aurora', 'adventurer-orc', 'Orc', 'player'),
    entry('api', 'srd-drow', 'Drow'),
    entry('aurora', 'drow', 'Drów'),
  ];

  it('keeps the entry from the pack higher up and never hides My content', () => {
    const shown = withDuplicates('creature', listingOf(entries), ORDER, true);
    expect(shown.duplicates).toEqual([
      { id: 'srd-goblin', pack: 'api', by: 'aurora' },
      { id: 'srd-orc', pack: 'api', by: MY_CONTENT },
      { id: 'srd-drow', pack: 'api', by: 'aurora' },
    ]);
    expect(ids(shown.listed)).toEqual(['mm-goblin', 'vgm-goblin', 'srd-hobgoblin', 'my-orc', 'adventurer-orc', 'drow']);
    expect(shown.entries).toBe(entries);
  });

  it('follows the pack order', () => {
    const shown = withDuplicates('creature', listingOf(entries), [MY_CONTENT, 'api', 'aurora'], true);
    expect(ids(shown.listed)).toEqual(['srd-goblin', 'srd-hobgoblin', 'my-orc', 'adventurer-orc', 'srd-drow']);
  });

  it('lists every entry but still counts the duplicates while they are shown', () => {
    const shown = withDuplicates('creature', listingOf(entries), ORDER, false);
    expect(shown.listed).toBe(entries);
    expect(shown.duplicates).toHaveLength(3);
  });

  it('leaves maps and tables alone', () => {
    const cave = createMap({ name: 'Cave', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
    const maps: LibraryEntry<'map'>[] = ['api', 'aurora'].map((pack) => ({
      ref: { area: 'data', id: `${pack}-cave` },
      doc: { ...cave, id: `${pack}-cave` },
      pack,
      overrides: [],
    }));
    const shown = withDuplicates('map', { entries: maps, problems: [], shadowed: [], unavailable: [] }, ORDER, true);
    expect(shown.listed).toEqual(maps);
    expect(shown.duplicates).toEqual([]);
  });
});

describe('library listings', () => {
  let repository: Repository;

  const creature = (id: string, name: string): Creature => ({ ...createCreature(name), id });
  const marker = (id: string, name: string): MarkerTemplate => ({ ...createMarkerTemplate(name), id });

  beforeEach(async () => {
    repository = new Repository(new MemoryStorage());
    useAppStore.setState({ repository });
    for (const pack of ['aurora', 'api']) {
      await repository.ensurePack(packManifestSchema.parse({ id: pack, name: pack }));
      await repository.save('creature', creature(`${pack}-goblin`, 'Goblin'), pack);
      await repository.save('creature', creature(`${pack}-wolf`, `${pack} Wolf`), pack);
      await repository.save('marker', marker(`${pack}-cone`, 'Cone'), pack);
    }
    await repository.save('creature', creature('my-wolf', 'Aurora Wolf'));
  });

  async function refreshed() {
    await useLibraryStore.getState().refreshAll();
    return useLibraryStore.getState().listings;
  }

  it('hides only the chosen kind of the chosen pack', async () => {
    repository.packSettings = {
      ...defaultPackSettings(),
      order: ['aurora', 'api'],
      hiddenKinds: { api: ['creature'] },
      hideDuplicates: false,
    };
    const listings = await refreshed();
    expect(ids(listings.creature.entries).sort()).toEqual(['aurora-goblin', 'aurora-wolf', 'my-wolf']);
    expect(listings.creature.unavailable).toEqual([
      { id: 'api-goblin', pack: 'api', hidden: true },
      { id: 'api-wolf', pack: 'api', hidden: true },
    ]);
    expect(ids(listings.marker.entries).sort()).toEqual(['api-cone', 'aurora-cone']);
  });

  it('lists one entry per name, from My content or the pack higher up, and keeps the others for lookups', async () => {
    repository.packSettings = { ...defaultPackSettings(), order: ['api', 'aurora'] };
    const listings = await refreshed();
    expect(ids(listings.creature.listed).sort()).toEqual(['api-goblin', 'api-wolf', 'my-wolf']);
    expect(listings.creature.duplicates).toEqual([
      { id: 'aurora-wolf', pack: 'aurora', by: MY_CONTENT },
      { id: 'aurora-goblin', pack: 'aurora', by: 'api' },
    ]);
    expect(ids(listings.creature.entries)).toContain('aurora-goblin');
    expect(ids(listings.marker.listed)).toEqual(['api-cone']);
  });

  it('still leaves out disabled packs', async () => {
    repository.packSettings = { ...defaultPackSettings(), disabled: ['api'] };
    const listings = await refreshed();
    expect(ids(listings.creature.listed).sort()).toEqual(['aurora-goblin', 'my-wolf']);
    expect(listings.creature.unavailable).toEqual([
      { id: 'api-goblin', pack: 'api', hidden: false },
      { id: 'api-wolf', pack: 'api', hidden: false },
    ]);
    expect(ids(listings.marker.listed)).toEqual(['aurora-cone']);
  });
});
