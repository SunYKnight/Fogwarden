import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '@/core/binary';
import { parseDamProject } from '@/core/import/damProject';
import { DAM_OBJECTS_PATH, emptyDamObjectChoices } from '@/core/import/damObjects';
import { createMap } from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import {
  damObjectPixels,
  damPropsFor,
  importModelFiles,
  listLibraryModels,
  loadDamObjectChoices,
  saveDamObjectChoices,
} from './daObjects';

/** Binary glTF whose JSON chunk references one external texture. */
function glb(): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(
    JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'Textures/colormap.png' }] }).padEnd(76, ' '),
  );
  const bytes = new Uint8Array(20 + json.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  return bytes;
}

function project() {
  const terrain = new ArrayBuffer(20 + 81 * 4);
  new Int32Array(terrain, 0, 5).set([-1, 0, 9, 9, 81]);
  return parseDamProject(
    JSON.stringify({
      Version: 11,
      width: 1,
      height: 1,
      terrainLayers: [{ terrain: bytesToBase64(new Uint8Array(terrain)) }],
      buildingBlockInstances: [
        { blockId: 'chest', center: { x: 0.5, y: 0.5 }, height: 0, scale: 1, rotation: 90 },
        { blockId: 'chest', center: { x: 0.2, y: 0.2 }, height: 0, scale: 1, rotation: 0 },
        { blockId: 'statue', center: { x: 0.8, y: 0.8 }, height: 0, scale: 1, rotation: 0 },
      ],
    }),
    'vault.dam',
  );
}

describe('Dungeon Alchemist object choices', () => {
  it('starts empty and round-trips through the readable JSON file', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    expect(await loadDamObjectChoices(repository)).toEqual(emptyDamObjectChoices());
    const choices = {
      ...emptyDamObjectChoices(),
      objects: { chest: { name: 'Chest', model: null, unitFt: 5, rotationDeg: 0 } },
    };
    await saveDamObjectChoices(repository, choices);
    expect(storage.files.data.get(DAM_OBJECTS_PATH)).toContain('"name": "Chest"');
    expect(await loadDamObjectChoices(repository)).toEqual(choices);
  });

  it('keeps picked model files in the library', async () => {
    const repository = new Repository(new MemoryStorage());
    const option = await importModelFiles(repository, [new File([glb()], 'My Chest.glb')]);
    expect(option.model).toEqual({ area: 'data', path: 'library/dungeon-alchemist-models/My Chest/My Chest.glb' });
    expect(await listLibraryModels(repository)).toEqual([{ label: 'My Chest', model: option.model, unitFt: 5 }]);
  });

  it('copies each chosen model with its texture next to the map once and places every object', async () => {
    const storage = new MemoryStorage();
    storage.files.content.set('models/cc0/chest.glb', glb());
    storage.files.content.set('models/cc0/Textures/colormap.png', new Uint8Array([7]));
    const repository = new Repository(storage);
    const map = createMap({ name: 'Vault', image: null, squaresX: 3, squaresY: 3, pxPerSquare: 100 });
    const choices = {
      ...emptyDamObjectChoices(),
      objects: {
        chest: {
          name: 'Chest',
          model: { area: 'content' as const, path: 'models/cc0/chest.glb' },
          unitFt: 2,
          rotationDeg: 0,
        },
        statue: { name: 'Statue', model: null, unitFt: 5, rotationDeg: 0 },
      },
    };
    const props = await damPropsFor(repository, project(), choices)(map.id, map.grid);
    const copy = `library/maps/${map.id}/assets/models/cc0/chest.glb`;
    expect(props.map((p) => p.asset.path)).toEqual([copy, copy]);
    expect(props[0]).toMatchObject({
      name: 'Chest',
      position: [7.5, 0, 7.5],
      rotationDeg: [0, -90, 0],
      scale: [2, 2, 2],
    });
    expect(storage.files.data.get(`library/maps/${map.id}/assets/models/cc0/Textures/colormap.png`)).toEqual(
      new Uint8Array([7]),
    );
  });

  it('marks every object of a kind on the calibrated picture, export margin included', () => {
    const calibration = { pxPerSquare: 100, rotationDeg: 0, offsetPx: { x: 10, y: -10 } };
    const pixels = damObjectPixels(project(), 'chest', { widthPx: 300, heightPx: 300 }, calibration);
    expect(pixels.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
      { x: 160, y: 140 },
      { x: 130, y: 170 },
    ]);
  });
});
