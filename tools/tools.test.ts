import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { imageSize } from '../src/core/imageSize';
import { encounterSchema } from '../src/core/model';
import { HeightField } from '../src/core/terrain/heightfield';
import { Repository } from '../src/data/repository';
import { StorageError } from '../src/data/storage';
import { createSampleEncounter, SAMPLE_GOBLIN, SAMPLE_MAP } from '../src/ui/home/sampleContent';
import { CONTENT_ROOT, PROJECT_ROOT } from './cli';
import { NodeStorage } from './nodeStorage';

const scratchParent = join(PROJECT_ROOT, 'data-local');
mkdirSync(scratchParent, { recursive: true });
const scratch = mkdtempSync(join(scratchParent, 'tools-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('shipped SRD content', () => {
  const repository = new Repository(new NodeStorage(scratch, CONTENT_ROOT));

  it('loads every creature and marker without problems', async () => {
    const creatures = await repository.list('creature');
    const markers = await repository.list('marker');
    expect(creatures.problems).toEqual([]);
    expect(markers.problems).toEqual([]);
    expect(creatures.entries.length).toBeGreaterThanOrEqual(300);
    expect(creatures.entries.every((e) => e.doc.license === 'CC-BY-4.0' && e.pack === 'srd')).toBe(true);
    expect(markers.entries.map((e) => [e.doc.name, e.doc.shape, e.doc.sizeFt])).toEqual([
      ['Burning Hands', 'cone', 15],
      ['Fireball', 'sphere', 20],
      ['Lightning Bolt', 'line', 100],
      ['Moonbeam', 'cylinder', 5],
      ['Thunderwave', 'cube', 15],
    ]);
  });

  it('ships every pack with a manifest and its license', async () => {
    const { packs, problems } = await repository.listPacks();
    expect(problems).toEqual([]);
    const shipped = packs.filter((p) => p.origin === 'shipped');
    expect(shipped.map((p) => [p.manifest.id, p.manifest.name])).toEqual([
      ['cc0-models', 'CC0 models'],
      ['sample-map', 'Sample map'],
      ['srd', 'SRD 5.1'],
    ]);
    expect(shipped.map((p) => p.counts)).toEqual([
      { creature: 0, marker: 0, map: 0, table: 0, item: 0, spell: 0, model: 11, portrait: 0 },
      { creature: 0, marker: 0, map: 1, table: 0, item: 0, spell: 0, model: 0, portrait: 0 },
      { creature: 334, marker: 5, map: 0, table: 0, item: 0, spell: 0, model: 0, portrait: 0 },
    ]);
    expect(shipped.every((p) => existsSync(join(CONTENT_ROOT, p.source.root, 'LICENSE.md')))).toBe(true);
  });
});

describe('shipped sample map', () => {
  const repository = new Repository(new NodeStorage(scratch, CONTENT_ROOT));

  it('loads with its image and the 3D features the sample is meant to show', async () => {
    const { entries, problems } = await repository.list('map');
    expect(problems).toEqual([]);
    const map = entries.find((e) => e.ref.id === SAMPLE_MAP.id)!.doc;
    const png = readFileSync(join(CONTENT_ROOT, map.image!.asset.path));
    expect(imageSize(png)).toEqual({ widthPx: map.image!.widthPx, heightPx: map.image!.heightPx });
    expect(map.grid.squaresX * map.grid.pxPerSquare).toBe(map.image!.widthPx);
    expect(map.openings.map((o) => o.kind)).toContain('door');
    expect(map.rooms).toHaveLength(1);
    expect(map.regions.some((r) => r.kind === 'light' && r.light === 'darkness')).toBe(true);
    expect(map.lights.length).toBeGreaterThan(0);
  });

  it('builds the sample encounter with four goblins and two PCs on the map', async () => {
    const map = await repository.load('map', SAMPLE_MAP);
    const goblin = await repository.load('creature', SAMPLE_GOBLIN);
    const encounter = encounterSchema.parse(createSampleEncounter(map, goblin));
    const terrain = HeightField.fromMap(map);
    expect(encounter.map).toEqual(SAMPLE_MAP);
    expect(encounter.combatants.filter((c) => c.side === 'enemy').map((c) => c.name)).toEqual([
      'Goblin 1',
      'Goblin 2',
      'Goblin 3',
      'Goblin 4',
    ]);
    expect(encounter.combatants.filter((c) => c.side === 'player')).toHaveLength(2);
    for (const { position } of encounter.combatants) {
      expect(position!.x).toBeGreaterThan(0);
      expect(position!.x).toBeLessThan(map.grid.squaresX * map.grid.feetPerSquare);
      expect(position!.y).toBeLessThan(map.grid.squaresY * map.grid.feetPerSquare);
      expect(position!.elevationFt).toBeCloseTo(terrain.sample(position!.x, position!.y), 6);
    }
  });
});

describe('NodeStorage', () => {
  const storage = new NodeStorage(scratch, CONTENT_ROOT);

  it('writes atomically without leaving temp files and lists sorted entries', async () => {
    await storage.writeText('a/b.json', '1');
    await storage.writeText('a/b.json', '2');
    await storage.writeBytes('a/A.bin', new Uint8Array([1]));
    expect(await storage.readText('data', 'a/b.json')).toBe('2');
    expect(readdirSync(join(scratch, 'a'))).not.toContain('b.json.tmp');
    expect(await storage.list('data', 'a')).toEqual([
      { name: 'A.bin', isDir: false },
      { name: 'b.json', isDir: false },
    ]);
    expect(await storage.list('data', 'missing')).toEqual([]);
  });

  it('refuses paths that leave the storage root', async () => {
    await expect(storage.readText('data', '../outside.json')).rejects.toThrow(StorageError);
    await expect(storage.writeText('a/../../x', '')).rejects.toThrow(StorageError);
    await expect(storage.writeText('C:/x', '')).rejects.toThrow(StorageError);
    await expect(storage.remove('')).rejects.toThrow(StorageError);
  });
});
