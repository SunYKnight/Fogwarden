import { describe, expect, it } from 'vitest';
import { BitSet } from '@/core/binary';
import { formatCreatureFile } from '@/core/import/creatureFile';
import {
  createCampaign,
  createCreature,
  createEncounter,
  createMap,
  ENCOUNTER_SCHEMA_VERSION,
  MAP_SCHEMA_VERSION,
  type AssetRef,
} from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { fogSize } from '@/core/vision/fog';
import { createPc } from '@/state/encounterActions';
import { migrateDataRoot } from './layoutMigration';
import { MemoryStorage } from './memoryStorage';
import { Repository } from './repository';

const json = (doc: unknown) => JSON.stringify(doc);
const ORC_ASSET: AssetRef = { area: 'data', path: 'library/creatures/assets/legacy--orc-image-orc.jpg' };
const GOBLIN_ASSET: AssetRef = { area: 'data', path: 'library/creatures/assets/srd-goblin-image-goblin.png' };

/** A data root as the app wrote it before creatures were text and blobs were pictures. */
function oldDataRoot() {
  const storage = new MemoryStorage();
  const files = storage.files.data;
  const orc = { ...createCreature('Orc'), id: 'legacy--orc', version: 1, image: ORC_ASSET, notes: 'Two\nlines' };
  files.set('library/creatures/legacy--orc.json', json(orc));
  files.set(ORC_ASSET.path, new Uint8Array([1, 2, 3]));
  const goblin = { ...createCreature('Goblin'), id: 'srd-goblin' };
  storage.files.content.set('packs/srd/pack.json', json({ id: 'srd', name: 'SRD 5.1' }));
  storage.files.content.set('packs/srd/creatures/srd-goblin.txt', formatCreatureFile(goblin));
  files.set(GOBLIN_ASSET.path, new Uint8Array([4, 5]));
  const portraits = { 'srd-goblin': { image: GOBLIN_ASSET, token: null } };
  files.set('library/portraits.json', json({ schema: 'portraits', version: 1, portraits }));

  const base = createMap({ name: 'Hill', image: null, squaresX: 3, squaresY: 2, pxPerSquare: 70 });
  const field = HeightField.fromMap(base);
  field.data.forEach((_, i) => (field.data[i] = (i % 7) * 0.5 - 3));
  const map = { ...base, id: 'm1', version: 1, terrain: { ...base.terrain, heights: field.encode() } };
  files.set('library/maps/m1/map.json', json(map));

  files.set('campaigns/c1/campaign.json', json({ ...createCampaign('Saga'), id: 'c1', version: 1, notes: '# Notes' }));
  const size = fogSize(map.grid, 2);
  const bits = new BitSet(size.cellsX * size.cellsY);
  bits.set(3, true);
  const pc = { ...createPc({ name: 'Thorin', armorClass: 10, maxHp: 9, senses: {}, visionSource: true }), id: 'pc1' };
  const encounter = createEncounter('Ambush', 'c1', { area: 'data', id: 'm1' });
  const fog = { ...encounter.fog, exploredBy: { pc1: bits.toBase64() }, hiddenByDm: bits.toBase64() };
  const combatants = [{ ...pc, token: ORC_ASSET }];
  files.set('campaigns/c1/encounters/e1.json', json({ ...encounter, id: 'e1', version: 2, combatants, fog }));
  return { storage, orc, map, field, encounter: { ...encounter, id: 'e1', combatants, fog } };
}

describe('migrateDataRoot', () => {
  it('converts an old data root to text, pictures by name, PNG blobs and notes.md', async () => {
    const { storage, orc, map, field, encounter } = oldDataRoot();
    const repository = new Repository(storage);
    expect(await migrateDataRoot(repository)).toEqual([]);

    const keys = [...storage.files.data.keys()].sort();
    expect(keys).toEqual([
      'campaigns/c1/campaign.json',
      'campaigns/c1/encounters/e1/encounter.json',
      'campaigns/c1/encounters/e1/fog/explored/pc1.png',
      'campaigns/c1/encounters/e1/fog/hidden.png',
      'campaigns/c1/notes.md',
      'library/creatures/legacy--orc.jpg',
      'library/creatures/legacy--orc.txt',
      'library/creatures/srd-goblin.png',
      'library/maps/m1/map.json',
      'library/maps/m1/terrain.png',
    ]);

    const orcRef = { area: 'data' as const, path: 'library/creatures/legacy--orc.jpg' };
    const loadedOrc = await repository.load('creature', { area: 'data', id: orc.id });
    expect(loadedOrc).toEqual({ ...orc, version: 2, image: orcRef });
    expect(storage.files.data.get(orcRef.path)).toEqual(new Uint8Array([1, 2, 3]));
    const goblin = (await repository.list('creature')).entries.find((e) => e.ref.id === 'srd-goblin')!;
    expect(goblin.doc.image).toEqual({ area: 'data', path: 'library/creatures/srd-goblin.png' });

    const loadedMap = await repository.load('map', { area: 'data', id: 'm1' });
    expect({ ...loadedMap, terrain: null }).toEqual({ ...map, version: MAP_SCHEMA_VERSION, terrain: null });
    expect(HeightField.fromMap(loadedMap).data).toEqual(field.data);

    const { campaigns } = await repository.listCampaigns();
    expect(campaigns.map((c) => [c.id, c.version, c.notes])).toEqual([['c1', 2, '# Notes']]);
    const loadedEncounter = await repository.loadEncounter('c1', 'e1');
    expect(loadedEncounter.combatants[0]!.token).toEqual(orcRef);
    expect(loadedEncounter.fog).toEqual(encounter.fog);
    expect(loadedEncounter.version).toBe(ENCOUNTER_SCHEMA_VERSION);

    expect(await migrateDataRoot(repository)).toEqual([]);
    expect([...storage.files.data.keys()].sort()).toEqual(keys);
  });

  it('keeps the old file and reports the document when the new files would lose data', async () => {
    const { storage } = oldDataRoot();
    const files = storage.files.data;
    const gif: AssetRef = { area: 'data', path: 'library/creatures/assets/imp.gif' };
    files.set(gif.path, new Uint8Array([9]));
    files.set('library/creatures/imp.json', json({ ...createCreature('Imp'), id: 'imp', version: 1, image: gif }));
    const broken = createMap({ name: 'Broken', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
    const heights = new HeightField(2, 2, 1).encode();
    files.set(
      'library/maps/m2/map.json',
      json({ ...broken, id: 'm2', version: 1, terrain: { ...broken.terrain, heights } }),
    );
    const repository = new Repository(storage);

    const problems = await migrateDataRoot(repository);
    expect(problems.map((p) => p.path)).toEqual(['library/creatures/imp.json', 'library/maps/m2/map.json']);
    expect(problems[0]!.message).toMatch(/^Kept in the old format: .*PNG, JPEG or WebP/);
    expect(files.has('library/creatures/imp.json')).toBe(true);
    expect(files.has('library/creatures/imp.txt')).toBe(false);
    expect(files.has(gif.path)).toBe(true);
    expect(files.has('library/maps/m2/terrain.png')).toBe(false);
    // Old pictures stay while any document still needs the old layout.
    expect(files.has(ORC_ASSET.path)).toBe(true);
    expect(files.has('library/portraits.json')).toBe(true);

    repository.layoutProblems = problems;
    expect((await repository.list('creature')).problems.map((p) => p.path)).toContain('library/creatures/imp.json');
    const mapProblems = (await repository.list('map')).problems.map((p) => p.path);
    expect(mapProblems).toContain('library/maps/m2/map.json');
  });
});
