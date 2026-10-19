import { describe, expect, it } from 'vitest';
import { BitSet } from '@/core/binary';
import { formatCreatureFile } from '@/core/import/creatureFile';
import {
  createCampaign,
  createCreature,
  createEncounter,
  createMap,
  defaultSettings,
  emptyPlayerSheet,
  type BattleMap,
  type Encounter,
} from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { fogSize } from '@/core/vision/fog';
import { MemoryStorage } from './memoryStorage';
import { packSource } from './packs';
import { campaignNotesPath, encounterDir, libraryDocPath, mapAssetRef, Repository } from './repository';

function setup() {
  const storage = new MemoryStorage();
  return { storage, repository: new Repository(storage) };
}

const text = (storage: MemoryStorage, path: string) => storage.files.data.get(path) as string;

/** Installs an empty pack `id` in the content root (shipped) or the data root (imported). */
function addPack(storage: MemoryStorage, area: 'data' | 'content', id: string, name = id) {
  storage.files[area].set(`packs/${id}/pack.json`, JSON.stringify({ id, name }));
}

const SRD = packSource('content', 'srd');

describe('Repository library listing', () => {
  it('lets a user copy shadow the shipped document with the same id', async () => {
    const { storage, repository } = setup();
    const shipped = createCreature('Goblin');
    addPack(storage, 'content', 'srd');
    storage.files.content.set(libraryDocPath('creature', SRD, shipped.id), formatCreatureFile(shipped));
    await repository.save('creature', { ...shipped, armorClass: 17 });

    const { entries } = await repository.list('creature');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ref.area).toBe('data');
    expect(entries[0]!.pack).toBe('my-content');
    expect(entries[0]!.overrides).toEqual(['srd']);
    expect(entries[0]!.doc.armorClass).toBe(17);
  });

  it('reports broken files as problems and still lists the valid ones', async () => {
    const { storage, repository } = setup();
    await repository.save('creature', createCreature('Orc'));
    storage.files.data.set('library/creatures/broken.txt', 'not a stat block');
    storage.files.data.set('library/markers/wrong.json', JSON.stringify({ schema: 'map', version: 1 }));

    const { entries, problems } = await repository.list('creature');
    expect(entries.map((e) => e.doc.name)).toEqual(['Orc']);
    expect(problems.map((p) => p.path)).toEqual(['library/creatures/broken.txt']);
    expect((await repository.list('marker')).problems.map((p) => p.path)).toEqual(['library/markers/wrong.json']);
  });

  it('refuses to save an invalid document', async () => {
    const { repository } = setup();
    await expect(repository.save('creature', { ...createCreature('X'), armorClass: 1.5 })).rejects.toThrow();
  });
});

describe('Repository creatures', () => {
  it('stores a creature as its stat block text', async () => {
    const { storage, repository } = setup();
    const orc = await repository.save('creature', { ...createCreature('Orc'), notes: 'Hates elves.' });
    const file = text(storage, `library/creatures/${orc.id}.txt`);
    expect(file).toContain('Orc');
    expect(file).toContain('Hates elves.');
    expect(await repository.load('creature', { area: 'data', id: orc.id })).toEqual(orc);
  });

  it('pictures a shipped creature with files named after its id, the token file before the image', async () => {
    const { storage, repository } = setup();
    const goblin = { ...createCreature('Goblin'), id: 'srd-goblin' };
    addPack(storage, 'content', 'srd');
    storage.files.content.set('packs/srd/creatures/srd-goblin.txt', formatCreatureFile(goblin));
    storage.files.data.set('library/creatures/srd-goblin.jpg', new Uint8Array([1]));
    storage.files.data.set('library/creatures/srd-goblin.token.webp', new Uint8Array([2]));

    const [entry] = (await repository.list('creature')).entries;
    expect(entry!.ref).toEqual({ area: 'content', id: 'srd-goblin' });
    expect(entry!.doc.image).toEqual({ area: 'data', path: 'library/creatures/srd-goblin.jpg' });
    expect(entry!.doc.token).toEqual({ area: 'data', path: 'library/creatures/srd-goblin.token.webp' });
  });

  it('copies pictures of a duplicate under its own name and replaces other extensions on import', async () => {
    const { storage, repository } = setup();
    const orc = createCreature('Orc');
    const image = await repository.importCreaturePicture(orc.id, 'image', 'orc.png', new Uint8Array([1]));
    const saved = await repository.save('creature', { ...orc, image });
    const copy = await repository.save('creature', { ...saved, id: 'orc-copy' });
    expect(copy.image).toEqual({ area: 'data', path: 'library/creatures/orc-copy.png' });
    expect(storage.files.data.get('library/creatures/orc-copy.png')).toEqual(new Uint8Array([1]));

    await repository.importCreaturePicture(orc.id, 'image', 'better.JPG', new Uint8Array([3]));
    expect(storage.files.data.has(`library/creatures/${orc.id}.png`)).toBe(false);
    expect((await repository.load('creature', { area: 'data', id: orc.id })).image).toEqual({
      area: 'data',
      path: `library/creatures/${orc.id}.jpg`,
    });
    await expect(repository.importCreaturePicture(orc.id, 'token', 'x.gif', new Uint8Array())).rejects.toThrow(
      /PNG, JPEG or WebP/,
    );
  });

  it('deletes the pictures with a user creature but keeps those of a shipped one', async () => {
    const { storage, repository } = setup();
    const shipped = { ...createCreature('Goblin'), id: 'srd-goblin' };
    addPack(storage, 'content', 'srd');
    storage.files.content.set('packs/srd/creatures/srd-goblin.txt', formatCreatureFile(shipped));
    const own = createCreature('Orc');
    for (const creature of [shipped, own]) {
      const image = await repository.importCreaturePicture(creature.id, 'image', 'a.png', new Uint8Array([1]));
      await repository.save('creature', { ...creature, image });
    }
    await repository.remove('creature', shipped.id);
    await repository.remove('creature', own.id);
    expect([...storage.files.data.keys()]).toEqual(['library/creatures/srd-goblin.png']);
  });
});

function sculptedMap(): BattleMap {
  const map = createMap({ name: 'Hill', image: null, squaresX: 3, squaresY: 2, pxPerSquare: 70 });
  const field = HeightField.fromMap(map);
  field.data.forEach((_, i) => (field.data[i] = Math.sin(i) * 7.3 - 2));
  return { ...map, terrain: { ...map.terrain, heights: field.encode() } };
}

describe('Repository maps', () => {
  it('keeps the heights in a 16-bit terrain.png next to a pretty map.json', async () => {
    const { storage, repository } = setup();
    const map = await repository.save('map', sculptedMap());
    const json = text(storage, `library/maps/${map.id}/map.json`);
    expect(json).toContain('\n  "terrain": {\n');
    expect(json).not.toContain('"heights"');
    const { heightmap } = JSON.parse(json).terrain as { heightmap: { file: string; feetPerUnit: number } };
    expect(heightmap.file).toBe('terrain.png');
    const png = storage.files.data.get(`library/maps/${map.id}/terrain.png`) as Uint8Array;
    expect(png[25]).toBe(0); // IHDR color type: grayscale
    expect(png[24]).toBe(16); // IHDR bit depth

    const loaded = await repository.load('map', { area: 'data', id: map.id });
    const before = HeightField.fromMap(map).data;
    const after = HeightField.fromMap(loaded).data;
    expect(after.every((h, i) => Math.abs(h - before[i]!) <= heightmap.feetPerUnit / 2)).toBe(true);
    expect({ ...loaded, terrain: null }).toEqual({ ...map, terrain: null });
    await repository.save('map', loaded);
    expect(HeightField.fromMap(await repository.load('map', { area: 'data', id: map.id })).data).toEqual(after);
  });

  it('duplicates a map with its own copy of the assets', async () => {
    const { storage, repository } = setup();
    const map = createMap({ name: 'Tavern', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
    const asset = await repository.importMapAsset(map.id, 'tavern map.jpg', new Uint8Array([1, 2, 3]));
    await repository.save('map', { ...map, image: { asset, widthPx: 140, heightPx: 140 } });

    const copy = await repository.duplicateMap({ area: 'data', id: map.id }, 'Tavern copy');
    await repository.remove('map', map.id);

    expect(copy.id).toBe('tavern-copy');
    expect(copy.image!.asset).toEqual(mapAssetRef(copy.id, 'tavern map.jpg'));
    expect(storage.files.data.get(copy.image!.asset.path)).toEqual(new Uint8Array([1, 2, 3]));
    expect((await repository.list('map')).entries.map((e) => e.doc.name)).toEqual(['Tavern copy']);
  });

  it('keeps shipped asset references when duplicating a shipped map', async () => {
    const { storage, repository } = setup();
    const map = createMap({ name: 'Forest', image: null, squaresX: 1, squaresY: 1, pxPerSquare: 70 });
    const shippedAsset = { area: 'content' as const, path: 'shared/forest.jpg' };
    const files = await repository.mapFiles({ ...map, image: { asset: shippedAsset, widthPx: 70, heightPx: 70 } });
    addPack(storage, 'content', 'sample');
    const sample = packSource('content', 'sample');
    storage.files.content.set(libraryDocPath('map', sample, map.id), files.json);
    storage.files.content.set(`packs/sample/maps/${map.id}/terrain.png`, files.terrain);
    const copy = await repository.duplicateMap({ area: 'content', id: map.id }, 'Forest copy');
    expect(copy.image!.asset).toEqual(shippedAsset);
  });

  it('sanitizes imported asset file names', async () => {
    const { repository } = setup();
    const ref = await repository.importMapAsset('m1', '../evil/name?.png', new Uint8Array([0]));
    expect(ref.path).toBe('library/maps/m1/assets/.._evil_name_.png');
  });
});

describe('Repository new document ids', () => {
  it('skips ids of user files, pictures and shipped documents, ignoring case', async () => {
    const { storage, repository } = setup();
    addPack(storage, 'content', 'srd');
    storage.files.content.set('packs/srd/creatures/goblin.txt', '');
    storage.files.data.set('library/creatures/Goblin-2.txt', '');
    storage.files.data.set('library/creatures/goblin-3.token.png', new Uint8Array([1]));
    expect(await repository.newLibraryId('creature', 'Goblin')).toBe('goblin-4');
    expect(await repository.newLibraryId('marker', '')).toBe('area');
  });

  it('counts up among campaigns and among the encounters of one campaign', async () => {
    const { repository } = setup();
    const saga = { ...createCampaign('Saga'), id: await repository.newCampaignId('Saga') };
    await repository.saveCampaign(saga);
    expect(saga.id).toBe('saga');
    expect(await repository.newCampaignId('Saga')).toBe('saga-2');
    const ambush = {
      ...createEncounter('Ambush', 'saga', null),
      id: await repository.newEncounterId('saga', 'Ambush'),
    };
    await repository.saveEncounter(ambush);
    expect(ambush.id).toBe('ambush');
    expect(await repository.newEncounterId('saga', 'Ambush')).toBe('ambush-2');
    expect(await repository.newEncounterId('other', 'Ambush')).toBe('ambush');
  });
});

describe('Repository campaigns and encounters', () => {
  async function encounterWithFog(repository: Repository): Promise<{ encounter: Encounter; map: BattleMap }> {
    const map = await repository.save(
      'map',
      createMap({ name: 'M', image: null, squaresX: 3, squaresY: 2, pxPerSquare: 70 }),
    );
    const encounter = createEncounter('Ambush', 'c1', { area: 'data', id: map.id });
    const size = fogSize(map.grid, encounter.fog.cellsPerSquare);
    const bits = new BitSet(size.cellsX * size.cellsY);
    bits.set(0, true);
    bits.set(size.cellsX * size.cellsY - 1, true);
    const fog = { ...encounter.fog, exploredBy: { pc1: bits.toBase64(), pc2: '' }, revealedByDm: bits.toBase64() };
    return { encounter: { ...encounter, fog }, map };
  }

  it('keeps campaign notes in notes.md', async () => {
    const { storage, repository } = setup();
    const campaign = await repository.saveCampaign({ ...createCampaign('Saga'), notes: '# Session 1\n\nThe end.' });
    expect(text(storage, campaignNotesPath(campaign.id))).toBe('# Session 1\n\nThe end.');
    expect(text(storage, `campaigns/${campaign.id}/campaign.json`)).not.toContain('notes');
    storage.files.data.set(campaignNotesPath(campaign.id), 'Edited by hand');
    expect((await repository.listCampaigns()).campaigns[0]!.notes).toBe('Edited by hand');
  });

  it("keeps a player's notes and sheet changes in the campaign's players folder", async () => {
    const { storage, repository } = setup();
    expect(await repository.loadPlayerNotes('saga', 'thorin')).toBe('');
    expect(await repository.loadPlayerSheet('saga', 'thorin')).toEqual(emptyPlayerSheet());
    await repository.storePlayerNotes('saga', 'thorin', '# Clues\n\nThe mayor lies.');
    expect(text(storage, 'campaigns/saga/players/thorin/notes.md')).toBe('# Clues\n\nThe mayor lies.');
    expect(await repository.loadPlayerNotes('saga', 'thorin')).toBe('# Clues\n\nThe mayor lies.');
    const overlay = {
      ...emptyPlayerSheet(),
      hitDiceUsed: 2,
      inventory: { '0': { name: 'Rope', quantity: 1, equipped: false } },
      currency: { gp: 12 },
      session: { hp: 7, tempHp: 3, slotsUsed: { '1': 2 }, deathSaves: { successes: 0, failures: 0 } },
    };
    await repository.storePlayerSheet('saga', 'thorin', overlay);
    expect(await repository.loadPlayerSheet('saga', 'thorin')).toEqual(overlay);
    expect(await repository.loadPlayerNotes('saga', 'anna')).toBe('');
  });

  it("keeps a player's sheet edits waiting for the DM in pending.json", async () => {
    const { storage, repository } = setup();
    expect(await repository.loadPlayerPending('saga', 'thorin')).toEqual([]);
    const edits = [
      { id: 'e1', edit: { field: 'hp', value: 7 }, text: 'Thorin: HP 12 → 7', before: '12' },
      { id: 'e2', edit: { field: 'currency', coin: 'gp', value: 9 }, text: 'Thorin: gp 12 → 9', before: '12' },
    ] as const;
    await repository.storePlayerPending('saga', 'thorin', edits);
    expect(JSON.parse(text(storage, 'campaigns/saga/players/thorin/pending.json'))).toMatchObject({
      schema: 'player-pending',
      version: 1,
    });
    expect(await repository.loadPlayerPending('saga', 'thorin')).toEqual(edits);
  });

  it('reads a sheet.json written before session state existed as rested', async () => {
    const { storage, repository } = setup();
    const { session: _session, ...older } = emptyPlayerSheet();
    storage.files.data.set('campaigns/saga/players/thorin/sheet.json', JSON.stringify({ ...older, hitDiceUsed: 1 }));
    expect(await repository.loadPlayerSheet('saga', 'thorin')).toEqual({ ...emptyPlayerSheet(), hitDiceUsed: 1 });
  });

  it('stores fog as black-and-white masks in the encounter folder and drops stale ones', async () => {
    const { storage, repository } = setup();
    const { encounter } = await encounterWithFog(repository);
    const saved = await repository.saveEncounter(encounter);
    const dir = encounterDir('c1', encounter.id);
    const files = () => [...storage.files.data.keys()].filter((k) => k.startsWith(`${dir}/`)).sort();
    expect(files()).toEqual([`${dir}/encounter.json`, `${dir}/fog/explored/pc1.png`, `${dir}/fog/revealed.png`]);
    expect(text(storage, `${dir}/encounter.json`)).not.toContain('exploredBy');

    const loaded = await repository.loadEncounter('c1', encounter.id);
    expect(loaded).toEqual(saved);
    expect(loaded.fog.exploredBy).toEqual({ pc1: encounter.fog.exploredBy.pc1 });

    await repository.saveEncounter({ ...loaded, fog: { ...loaded.fog, exploredBy: {}, revealedByDm: '' } });
    expect(files()).toEqual([`${dir}/encounter.json`]);
    expect((await repository.listEncounters('c1')).encounters.map((e) => e.name)).toEqual(['Ambush']);
  });

  it('forgets fog masks of a map that was resized since, like the fog itself', async () => {
    const { repository } = setup();
    const { encounter, map } = await encounterWithFog(repository);
    await repository.saveEncounter(encounter);
    const terrain = { ...map.terrain, heights: '' };
    await repository.save('map', { ...map, grid: { ...map.grid, squaresX: 4 }, terrain });
    const loaded = await repository.loadEncounter('c1', encounter.id);
    expect(loaded.fog.exploredBy).toEqual({});
    expect(loaded.fog.revealedByDm).toBe('');
  });
});

describe('Repository settings', () => {
  it('returns defaults until settings are saved', async () => {
    const { repository } = setup();
    expect(await repository.loadSettings()).toEqual(defaultSettings());
    await repository.saveSettings({ ...defaultSettings(), diagonalRule: '5-10-5' });
    expect((await repository.loadSettings()).diagonalRule).toBe('5-10-5');
  });

  it('saves unchanged settings byte for byte the same', async () => {
    const { storage, repository } = setup();
    await repository.saveSettings(defaultSettings());
    const first = text(storage, 'settings.json');
    await repository.saveSettings(await repository.loadSettings());
    expect(text(storage, 'settings.json')).toBe(first);
    expect(first).toContain('\n  "schema": "settings",\n');
  });

  it('never overwrites a settings.json it could not read, until it reads again', async () => {
    const { storage, repository } = setup();
    const newer = JSON.stringify({ schema: 'settings', version: 999, secret: 'keep me' });
    storage.files.data.set('settings.json', newer);
    await expect(repository.loadSettings()).rejects.toThrow();
    await expect(repository.saveSettings(defaultSettings())).rejects.toThrow(/not saved/);
    expect(text(storage, 'settings.json')).toBe(newer);
    storage.files.data.delete('settings.json');
    await repository.loadSettings();
    await repository.saveSettings(defaultSettings());
    expect(text(storage, 'settings.json')).toContain('"schema": "settings"');
  });
});
