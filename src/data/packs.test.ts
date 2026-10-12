import { describe, expect, it } from 'vitest';
import { formatCreatureFile } from '@/core/import/creatureFile';
import { createCreature, createEncounter, createMap, type Creature } from '@/core/model';
import { MemoryStorage } from './memoryStorage';
import { exportManifest, exportPack, installPack, PackExistsError, readPackZip, removePack } from './packArchive';
import { MY_CONTENT, packSource } from './packs';
import { libraryDocPath, Repository } from './repository';

function setup() {
  const storage = new MemoryStorage();
  return { storage, repository: new Repository(storage) };
}

function creature(id: string, name: string): Creature {
  return { ...createCreature(name), id };
}

/** A pack in the content root (shipped) or data root (imported) holding `creatures`. */
function addPack(storage: MemoryStorage, area: 'data' | 'content', id: string, creatures: Creature[]) {
  storage.files[area].set(`packs/${id}/pack.json`, JSON.stringify({ id, name: `Pack ${id}`, version: '2' }));
  for (const c of creatures) {
    storage.files[area].set(libraryDocPath('creature', packSource(area, id), c.id), formatCreatureFile(c));
  }
}

async function winners(repository: Repository) {
  const { entries } = await repository.list('creature');
  return Object.fromEntries(entries.map((e) => [e.ref.id, e.pack]));
}

describe('content pack precedence', () => {
  it('lets My content win, then packs in the settings order, and reports what is overridden by whom', async () => {
    const { storage, repository } = setup();
    addPack(storage, 'content', 'srd', [creature('goblin', 'Goblin'), creature('wolf', 'Wolf')]);
    addPack(storage, 'data', 'mm', [creature('goblin', 'MM Goblin'), creature('orc', 'MM Orc')]);
    await repository.save('creature', creature('orc', 'My Orc'));

    repository.packSettings = { order: ['srd', 'mm'], disabled: [] };
    expect(await winners(repository)).toEqual({ goblin: 'srd', wolf: 'srd', orc: MY_CONTENT });
    const listing = await repository.list('creature');
    expect(listing.shadowed).toEqual([
      { id: 'goblin', pack: 'mm', by: 'srd' },
      { id: 'orc', pack: 'mm', by: MY_CONTENT },
    ]);
    expect(listing.entries.find((e) => e.ref.id === 'orc')!.overrides).toEqual(['mm']);
    expect((await repository.load('creature', { area: 'content', id: 'goblin' })).name).toBe('Goblin');

    repository.packSettings = { order: ['mm', 'srd'], disabled: [] };
    expect(await winners(repository)).toEqual({ goblin: 'mm', wolf: 'srd', orc: MY_CONTENT });
    expect((await repository.load('creature', { area: 'content', id: 'goblin' })).name).toBe('MM Goblin');
  });

  it('ranks packs the settings do not name yet after the named ones, imported before built-in', async () => {
    const { storage, repository } = setup();
    addPack(storage, 'content', 'srd', [creature('goblin', 'Goblin')]);
    addPack(storage, 'data', 'mm', [creature('goblin', 'MM Goblin')]);
    addPack(storage, 'data', 'zz', [creature('goblin', 'ZZ Goblin')]);
    expect((await repository.installedPacks()).map((p) => p.source.pack)).toEqual([MY_CONTENT, 'mm', 'zz', 'srd']);
    repository.packSettings = { order: ['zz'], disabled: [] };
    expect((await repository.installedPacks()).map((p) => p.source.pack)).toEqual([MY_CONTENT, 'zz', 'mm', 'srd']);
  });
});

describe('disabled content packs', () => {
  it('hide their entries, name the pack when an encounter asks for one and keep counting them', async () => {
    const { storage, repository } = setup();
    addPack(storage, 'content', 'srd', [creature('goblin', 'Goblin'), creature('wolf', 'Wolf')]);
    addPack(storage, 'data', 'mm', [creature('goblin', 'MM Goblin')]);
    repository.packSettings = { order: [], disabled: ['srd'] };

    expect(await winners(repository)).toEqual({ goblin: 'mm' });
    expect((await repository.list('creature')).unavailable).toEqual([{ id: 'wolf', pack: 'srd' }]);
    await expect(repository.load('creature', { area: 'content', id: 'wolf' })).rejects.toThrow(/disabled pack "srd"/);
    const { packs } = await repository.listPacks();
    expect(packs.map((p) => [p.source.pack, p.enabled, p.counts.creature])).toEqual([
      [MY_CONTENT, true, 0],
      ['mm', true, 1],
      ['srd', false, 2],
    ]);

    repository.packSettings = { order: [], disabled: [] };
    expect(await winners(repository)).toEqual({ goblin: 'mm', wolf: 'srd' });
  });

  it("still give an encounter on a disabled pack's map its fog grid, so saving keeps the fog", async () => {
    const { storage, repository } = setup();
    addPack(storage, 'data', 'maps', []);
    const map = createMap({ name: 'Cave', image: null, squaresX: 4, squaresY: 3, pxPerSquare: 70 });
    await repository.storeMap(map, 'maps');
    repository.packSettings = { order: [], disabled: ['maps'] };
    const encounter = createEncounter('Ambush', 'c1', { area: 'data', id: map.id });
    expect(await repository.encounterFogSize(encounter)).not.toBeNull();
    await expect(repository.load('map', { area: 'data', id: map.id })).rejects.toThrow(/disabled pack "maps"/);
    expect(storage.files.data.has(`packs/maps/maps/${map.id}/map.json`)).toBe(true);
  });
});

describe('pack zip export and import', () => {
  it('round-trips My content into another data root as a pack whose map pictures point into it', async () => {
    const source = setup();
    const map = createMap({ name: 'Tavern', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
    const asset = await source.repository.importMapAsset(map.id, 'tavern.png', new Uint8Array([7, 8, 9]));
    await source.repository.save('map', { ...map, image: { asset, widthPx: 140, heightPx: 140 } });
    await source.repository.save('creature', creature('orc', 'Orc'));
    const mine = (await source.repository.listPacks()).packs[0]!;
    const manifest = exportManifest(mine, new Date('2026-10-12T10:00:00Z'));
    const zip = await exportPack(source.repository, mine.source, manifest);

    const target = setup();
    const pack = await readPackZip(zip);
    expect(pack.manifest).toMatchObject({ id: 'my-content-2026-10-12', name: 'My content 2026-10-12' });
    await installPack(target.repository, pack, false);

    const maps = await target.repository.list('map');
    expect(maps.entries.map((e) => [e.doc.name, e.pack])).toEqual([['Tavern', 'my-content-2026-10-12']]);
    const image = maps.entries[0]!.doc.image!.asset;
    expect(image).toEqual({ area: 'data', path: `packs/my-content-2026-10-12/maps/${map.id}/assets/tavern.png` });
    expect(target.storage.files.data.get(image.path)).toEqual(new Uint8Array([7, 8, 9]));
    expect((await target.repository.list('creature')).entries.map((e) => e.doc.name)).toEqual(['Orc']);
    expect([...target.storage.files.data.keys()].some((k) => k.includes('.importing'))).toBe(false);

    await expect(installPack(target.repository, pack, false)).rejects.toBeInstanceOf(PackExistsError);
    await installPack(target.repository, pack, true);
    await removePack(target.repository, pack.manifest.id);
    expect((await target.repository.list('map')).entries).toEqual([]);
  });

  it('exports a pack under its own manifest and refuses to install over a built-in pack', async () => {
    const { storage, repository } = setup();
    addPack(storage, 'content', 'srd', [creature('goblin', 'Goblin')]);
    const srd = (await repository.listPacks()).packs.find((p) => p.source.pack === 'srd')!;
    const zip = await exportPack(repository, srd.source, exportManifest(srd, new Date()));
    const pack = await readPackZip(zip);
    expect(pack.manifest).toMatchObject({ id: 'srd', name: 'Pack srd', version: '2' });
    expect(pack.files.map((f) => f.path).sort()).toEqual(['creatures/goblin.txt', 'pack.json']);
    await expect(installPack(repository, pack, true)).rejects.toThrow(/built-in pack/);
  });
});
