import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assetRefSchema,
  createCreature,
  createMap,
  createMarkerTemplate,
  defaultSettings,
  type AssetRef,
  type StorageArea,
} from '@/core/model';
import { MemoryStorage } from './memoryStorage';
import { migrateToPacks } from './packMigration';
import { Repository } from './repository';

const LEGACY = 'packs/legacy-dm-tool';
const PICTURE: AssetRef = { area: 'data', path: 'library/creatures/legacy--goblin.jpg' };

/** A data root as the app wrote it before packs, settings v6. */
async function dataRootBeforePacks(storage: MemoryStorage) {
  const repository = new Repository(storage);
  const { packs: _new, ...settings } = defaultSettings();
  storage.files.data.set('settings.json', JSON.stringify({ ...settings, version: 6 }));

  const goblin = { ...createCreature('Goblin'), id: 'legacy--goblin', source: 'Legacy DM Tool' };
  const image = await repository.importCreaturePicture(goblin.id, 'image', 'g.jpg', new Uint8Array([1, 2]));
  await repository.storeCreature({ ...goblin, image });
  await repository.storeCreature(createCreature('Own Orc'));
  const marker = { ...createMarkerTemplate('Fireball'), id: 'legacy--fireball' };
  storage.files.data.set('library/markers/legacy--fireball.json', `${JSON.stringify(marker, null, 2)}\n`);

  const cellar = createMap({ name: 'Cellar', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
  const cellarId = 'legacy--cellar';
  const cellarImage = await repository.importMapAsset(cellarId, 'cellar.png', new Uint8Array([3]));
  await repository.storeMap({ ...cellar, id: cellarId, image: { asset: cellarImage, widthPx: 140, heightPx: 140 } });
  const hill = createMap({ name: 'Hill', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
  const sample: AssetRef = { area: 'content', path: 'maps/sample-chapel/assets/chapel.png' };
  const barrel: AssetRef = { area: 'content', path: 'models/cc0/barrel.glb' };
  const prop = { id: 'p1', asset: barrel };
  const hillMap = { ...hill, id: 'hill', image: { asset: sample, widthPx: 140, heightPx: 140 } };
  const { json: hillJson, terrain } = await repository.mapFiles(hillMap);
  const hillFile = JSON.parse(hillJson) as Record<string, unknown>;
  storage.files.data.set('library/maps/hill/map.json', JSON.stringify({ ...hillFile, extra: [prop] }, null, 2));
  storage.files.data.set('library/maps/hill/terrain.png', terrain);

  const encounter = { schema: 'encounter', id: 'e1', combatants: [{ id: 'c1', token: PICTURE, creature: null }] };
  storage.files.data.set('campaigns/c1/encounters/e1/encounter.json', `${JSON.stringify(encounter, null, 2)}\n`);
  const choices = { objects: { chest: { model: { area: 'content', path: 'models/cc0/chest.glb' } } } };
  storage.files.data.set('library/dungeon-alchemist-objects.json', JSON.stringify(choices));
  return repository;
}

const hillSchema = z.object({
  image: z.object({ asset: assetRefSchema }),
  extra: z.array(z.object({ asset: assetRefSchema })),
});
const encounterSchema = z.object({ combatants: z.array(z.object({ token: assetRefSchema })) });
const versionSchema = z.object({ version: z.number() });

function readJson<T>(storage: MemoryStorage, path: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(storage.files.data.get(path) as string));
}

/** Storage whose read-back of one file differs from what was written there. */
class FlakyStorage extends MemoryStorage {
  constructor(private readonly flaky: string) {
    super();
  }

  override async readBytes(area: StorageArea, path: string): Promise<Uint8Array> {
    const bytes = await super.readBytes(area, path);
    return path === this.flaky ? new Uint8Array([9, 9, 9]) : bytes;
  }
}

describe('migrateToPacks', () => {
  it('moves legacy imports into their pack and points every reference at the packs', async () => {
    const storage = new MemoryStorage();
    const repository = await dataRootBeforePacks(storage);
    expect(await migrateToPacks(repository)).toEqual([]);

    const keys = [...storage.files.data.keys()];
    expect(keys.filter((k) => k.includes('legacy--')).sort()).toEqual([
      `${LEGACY}/creatures/legacy--goblin.jpg`,
      `${LEGACY}/creatures/legacy--goblin.txt`,
      `${LEGACY}/maps/legacy--cellar/assets/cellar.png`,
      `${LEGACY}/maps/legacy--cellar/map.json`,
      `${LEGACY}/maps/legacy--cellar/terrain.png`,
      `${LEGACY}/markers/legacy--fireball.json`,
    ]);
    expect(storage.files.data.has(`${LEGACY}/pack.json`)).toBe(true);

    const creatures = await repository.list('creature');
    expect(creatures.entries.map((e) => [e.doc.name, e.pack])).toEqual([
      ['Goblin', 'legacy-dm-tool'],
      ['Own Orc', 'my-content'],
    ]);
    expect(creatures.entries[0]!.doc.image).toEqual({ area: 'data', path: `${LEGACY}/creatures/legacy--goblin.jpg` });
    const cellar = await repository.load('map', { area: 'data', id: 'legacy--cellar' });
    expect(cellar.image!.asset).toEqual({ area: 'data', path: `${LEGACY}/maps/legacy--cellar/assets/cellar.png` });

    const hill = readJson(storage, 'library/maps/hill/map.json', hillSchema);
    expect(hill.image.asset.path).toBe('packs/sample-map/maps/sample-chapel/assets/chapel.png');
    expect(hill.extra[0]!.asset.path).toBe('packs/cc0-models/models/barrel.glb');
    const encounter = readJson(storage, 'campaigns/c1/encounters/e1/encounter.json', encounterSchema);
    expect(encounter.combatants[0]!.token.path).toBe(`${LEGACY}/creatures/legacy--goblin.jpg`);
    const choices = readJson(storage, 'library/dungeon-alchemist-objects.json', z.unknown());
    expect(choices).toEqual({
      objects: { chest: { model: { area: 'content', path: 'packs/cc0-models/models/chest.glb' } } },
    });

    expect(readJson(storage, 'settings.json', versionSchema).version).toBe(defaultSettings().version);
    const after = new Map(storage.files.data);
    expect(await migrateToPacks(repository)).toEqual([]);
    expect(storage.files.data).toEqual(after);
  });

  it('keeps every old file when a copy does not read back intact, and finishes on the next start', async () => {
    const storage = new FlakyStorage(`${LEGACY}/creatures/legacy--goblin.jpg`);
    const repository = await dataRootBeforePacks(storage);
    const problems = await migrateToPacks(repository);

    expect(problems.map((p) => p.path)).toEqual(['library/creatures/legacy--goblin.txt']);
    expect(problems[0]!.message).toMatch(/differs/);
    for (const old of [
      'library/creatures/legacy--goblin.txt',
      PICTURE.path,
      'library/markers/legacy--fireball.json',
      'library/maps/legacy--cellar/map.json',
    ]) {
      expect(storage.files.data.has(old)).toBe(true);
    }
    const encounter = readJson(storage, 'campaigns/c1/encounters/e1/encounter.json', encounterSchema);
    expect(encounter.combatants[0]!.token).toEqual(PICTURE);
    expect(readJson(storage, 'settings.json', versionSchema).version).toBe(6);

    const healthy = new MemoryStorage();
    healthy.files.data = storage.files.data;
    expect(await migrateToPacks(new Repository(healthy))).toEqual([]);
    expect(healthy.files.data.has(PICTURE.path)).toBe(false);
  });
});
