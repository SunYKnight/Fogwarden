import { describe, expect, it } from 'vitest';
import { createCreature, createMap, defaultSettings } from '@/core/model';
import { MemoryStorage } from './memoryStorage';
import { libraryDocPath, mapAssetRef, Repository } from './repository';

function setup() {
  const storage = new MemoryStorage();
  return { storage, repository: new Repository(storage) };
}

describe('Repository library listing', () => {
  it('lets a user copy shadow the shipped document with the same id', async () => {
    const { storage, repository } = setup();
    const shipped = createCreature('Goblin');
    storage.files.content.set(libraryDocPath('creature', 'content', shipped.id), JSON.stringify(shipped));
    await repository.save('creature', { ...shipped, armorClass: 17 });

    const { entries } = await repository.list('creature');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ref.area).toBe('data');
    expect(entries[0]!.overridesContent).toBe(true);
    expect(entries[0]!.doc.armorClass).toBe(17);
  });

  it('reports broken files as problems and still lists the valid ones', async () => {
    const { storage, repository } = setup();
    await repository.save('creature', createCreature('Orc'));
    storage.files.data.set('library/creatures/broken.json', '{ not json');
    storage.files.data.set('library/creatures/wrong.json', JSON.stringify({ schema: 'map', version: 1 }));

    const { entries, problems } = await repository.list('creature');
    expect(entries.map((e) => e.doc.name)).toEqual(['Orc']);
    expect(problems.map((p) => p.path).sort()).toEqual([
      'library/creatures/broken.json',
      'library/creatures/wrong.json',
    ]);
  });

  it('refuses to save an invalid document', async () => {
    const { repository } = setup();
    await expect(repository.save('creature', { ...createCreature('X'), armorClass: 1.5 })).rejects.toThrow();
  });
});

describe('Repository maps', () => {
  it('duplicates a map with its own copy of the assets', async () => {
    const { storage, repository } = setup();
    const map = createMap({ name: 'Tavern', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
    const asset = await repository.importMapAsset(map.id, 'tavern map.jpg', new Uint8Array([1, 2, 3]));
    await repository.save('map', { ...map, image: { asset, widthPx: 140, heightPx: 140 } });

    const copy = await repository.duplicateMap({ area: 'data', id: map.id }, 'Tavern copy');
    await repository.remove('map', map.id);

    expect(copy.image!.asset).toEqual(mapAssetRef(copy.id, 'tavern map.jpg'));
    expect(storage.files.data.get(copy.image!.asset.path)).toEqual(new Uint8Array([1, 2, 3]));
    expect((await repository.list('map')).entries.map((e) => e.doc.name)).toEqual(['Tavern copy']);
  });

  it('keeps shipped asset references when duplicating a shipped map', async () => {
    const { storage, repository } = setup();
    const map = createMap({ name: 'Forest', image: null, squaresX: 1, squaresY: 1, pxPerSquare: 70 });
    const shippedAsset = { area: 'content' as const, path: 'shared/forest.jpg' };
    storage.files.content.set(
      libraryDocPath('map', 'content', map.id),
      JSON.stringify({ ...map, image: { asset: shippedAsset, widthPx: 70, heightPx: 70 } }),
    );
    const copy = await repository.duplicateMap({ area: 'content', id: map.id }, 'Forest copy');
    expect(copy.image!.asset).toEqual(shippedAsset);
  });

  it('sanitizes imported asset file names', async () => {
    const { repository } = setup();
    const ref = await repository.importMapAsset('m1', '../evil/name?.png', new Uint8Array([0]));
    expect(ref.path).toBe('library/maps/m1/assets/.._evil_name_.png');
  });
});

describe('Repository settings', () => {
  it('returns defaults until settings are saved', async () => {
    const { repository } = setup();
    expect(await repository.loadSettings()).toEqual(defaultSettings());
    await repository.saveSettings({ ...defaultSettings(), diagonalRule: '5-10-5' });
    expect((await repository.loadSettings()).diagonalRule).toBe('5-10-5');
  });
});
