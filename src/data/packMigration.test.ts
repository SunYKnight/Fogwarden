import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assetRefSchema, createMap, defaultSettings, type AssetRef, type StorageArea } from '@/core/model';
import { MemoryStorage } from './memoryStorage';
import { migrateToPacks } from './packMigration';
import { Repository } from './repository';

const PICTURE: AssetRef = { area: 'data', path: 'library/creatures/goblin.jpg' };
const HILL = 'library/maps/hill/map.json';

/** A data root as the app wrote it before packs, settings v6. */
async function dataRootBeforePacks(storage: MemoryStorage) {
  const repository = new Repository(storage);
  const { packs: _new, ...settings } = defaultSettings();
  storage.files.data.set('settings.json', JSON.stringify({ ...settings, version: 6 }));

  const hill = createMap({ name: 'Hill', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
  const sample: AssetRef = { area: 'content', path: 'maps/sample-chapel/assets/chapel.png' };
  const barrel: AssetRef = { area: 'content', path: 'models/cc0/barrel.glb' };
  const prop = { id: 'p1', asset: barrel };
  const hillMap = { ...hill, id: 'hill', image: { asset: sample, widthPx: 140, heightPx: 140 } };
  const { json: hillJson, terrain } = await repository.mapFiles(hillMap);
  const hillFile = JSON.parse(hillJson) as Record<string, unknown>;
  storage.files.data.set(HILL, JSON.stringify({ ...hillFile, extra: [prop] }, null, 2));
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

/** Storage whose first read-back of one file after a write differs from what was written there. */
class FlakyStorage extends MemoryStorage {
  private writes = 0;

  constructor(private readonly flaky: string) {
    super();
  }

  override async writeText(path: string, text: string): Promise<void> {
    this.writes += path === this.flaky ? 1 : 0;
    await super.writeText(path, text);
  }

  override async readText(area: StorageArea, path: string): Promise<string> {
    const text = await super.readText(area, path);
    return path === this.flaky && this.writes === 1 ? `${text} ` : text;
  }
}

describe('migrateToPacks', () => {
  it('points every reference to shipped files at the packs', async () => {
    const storage = new MemoryStorage();
    const repository = await dataRootBeforePacks(storage);
    expect(await migrateToPacks(repository)).toEqual([]);

    const hill = readJson(storage, HILL, hillSchema);
    expect(hill.image.asset.path).toBe('packs/sample-map/maps/sample-chapel/assets/chapel.png');
    expect(hill.extra[0]!.asset.path).toBe('packs/cc0-models/models/barrel.glb');
    const encounter = readJson(storage, 'campaigns/c1/encounters/e1/encounter.json', encounterSchema);
    expect(encounter.combatants[0]!.token).toEqual(PICTURE);
    const choices = readJson(storage, 'library/dungeon-alchemist-objects.json', z.unknown());
    expect(choices).toEqual({
      objects: { chest: { model: { area: 'content', path: 'packs/cc0-models/models/chest.glb' } } },
    });

    expect(readJson(storage, 'settings.json', versionSchema).version).toBe(defaultSettings().version);
    const after = new Map(storage.files.data);
    expect(await migrateToPacks(repository)).toEqual([]);
    expect(storage.files.data).toEqual(after);
  });

  it('restores a document that does not read back intact, and finishes on the next start', async () => {
    const storage = new FlakyStorage(HILL);
    const repository = await dataRootBeforePacks(storage);
    const before = storage.files.data.get(HILL);
    const problems = await migrateToPacks(repository);

    expect(problems.map((p) => p.path)).toEqual([HILL]);
    expect(problems[0]!.message).toMatch(/reads back differently/);
    expect(storage.files.data.get(HILL)).toBe(before);
    expect(readJson(storage, 'settings.json', versionSchema).version).toBe(6);

    const healthy = new MemoryStorage();
    healthy.files.data = storage.files.data;
    expect(await migrateToPacks(new Repository(healthy))).toEqual([]);
    expect(readJson(healthy, HILL, hillSchema).image.asset.path).toBe(
      'packs/sample-map/maps/sample-chapel/assets/chapel.png',
    );
  });
});
