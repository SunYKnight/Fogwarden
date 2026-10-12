import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '@/core/binary';
import { parseDamProject } from '@/core/import/damProject';
import { HeightField } from '@/core/terrain/heightfield';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import {
  cornerGesture,
  createCalibratedMap,
  gridFromFileName,
  guessCalibration,
  hasTransparency,
  mapNameFromFileName,
  roundCalibration,
  saveImportedMap,
} from './mapImport';

describe('map import helpers', () => {
  it('reads the square count and a readable name from the file name', () => {
    expect(gridFromFileName('52x49_tavern.jpg')).toEqual({ squaresX: 52, squaresY: 49 });
    expect(gridFromFileName('tavern.jpg')).toBeNull();
    expect(mapNameFromFileName('52x49_old__tavern.jpg')).toBe('52x49 old tavern');
    expect(mapNameFromFileName('Crypt UniversalVTT.dd2vtt')).toBe('Crypt');
  });

  it('guesses the square size from the name, else 70 px', () => {
    const image = { widthPx: 2600, heightPx: 2450 };
    expect(guessCalibration('52x49_tavern.jpg', image).pxPerSquare).toBe(50);
    expect(guessCalibration('tavern.jpg', image)).toEqual({
      pxPerSquare: 70,
      rotationDeg: 0,
      offsetPx: { x: 0, y: 0 },
    });
  });

  it('rounds calibrations to hundredths', () => {
    const rounded = roundCalibration({ pxPerSquare: 33.33333, rotationDeg: -1.006, offsetPx: { x: 0.004, y: 12.345 } });
    expect(rounded).toEqual({ pxPerSquare: 33.33, rotationDeg: -1.01, offsetPx: { x: 0, y: 12.35 } });
  });
});

describe('cornerGesture', () => {
  const a = { x: 10, y: 10 };
  const b = { x: 60, y: 60 };

  it('takes a drag as the square', () => {
    expect(cornerGesture(null, a, b, 4)).toEqual({ pending: null, square: [a, b] });
  });

  it('completes a square with a second click and ignores jitter', () => {
    const first = cornerGesture(null, a, { x: 11, y: 10 }, 4);
    expect(first).toEqual({ pending: { x: 11, y: 10 }, square: null });
    expect(cornerGesture(first.pending, b, b, 4)).toEqual({ pending: null, square: [{ x: 11, y: 10 }, b] });
    expect(cornerGesture(first.pending, a, a, 4)).toEqual({ pending: a, square: null });
  });
});

describe('createCalibratedMap', () => {
  it('saves the map with the calibrated grid and squares covering the image', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const file = new File([new Uint8Array([1, 2, 3])], 'cellar.png', { type: 'image/png' });
    const calibration = { pxPerSquare: 100, rotationDeg: 1.5, offsetPx: { x: 12, y: -8 } };
    const map = await createCalibratedMap(repository, file, {
      name: 'Cellar',
      image: { widthPx: 2000, heightPx: 1640 },
      calibration,
    });
    expect(map.grid).toMatchObject({ ...calibration, squaresX: 20, squaresY: 16 });
    expect(map.image).toEqual({
      asset: { area: 'data', path: `library/maps/${map.id}/assets/cellar.png` },
      widthPx: 2000,
      heightPx: 1640,
    });
    expect(storage.files.data.get(map.image!.asset.path)).toEqual(new Uint8Array([1, 2, 3]));
    expect((await repository.load('map', { area: 'data', id: map.id })).grid).toEqual(map.grid);
  });
});

describe('saveImportedMap', () => {
  const content = {
    walls: [],
    openings: [],
    rooms: [],
    lights: [],
    ambientLight: 'dim' as const,
    notes: 'Lighting is baked into the battlemap image.',
  };
  // One tile of Dungeon Alchemist terrain, 1 tile (5 ft) high everywhere.
  const terrain = new ArrayBuffer(20 + 81 * 4);
  new Int32Array(terrain, 0, 5).set([-1, 0, 9, 9, 81]);
  new Float32Array(terrain, 20).fill(1);
  const project = parseDamProject(
    JSON.stringify({
      Version: 11,
      width: 1,
      height: 1,
      terrainLayers: [{ terrain: bytesToBase64(new Uint8Array(terrain)) }],
    }),
    'cellar.dam',
  );

  it('saves export content and the project terrain with the map', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const map = await saveImportedMap(repository, {
      name: 'Cellar',
      image: { widthPx: 300, heightPx: 300 },
      calibration: { pxPerSquare: 100, rotationDeg: 0, offsetPx: { x: 0, y: 0 } },
      content,
      project,
      writeImage: async (mapId) => ({
        asset: await repository.importMapAsset(mapId, 'cellar.jpg', new Uint8Array([1])),
        widthPx: 300,
        heightPx: 300,
      }),
    });
    const loaded = await repository.load('map', { area: 'data', id: map.id });
    expect(loaded).toMatchObject({ ambientLight: 'dim', notes: content.notes });
    expect(HeightField.fromMap(loaded).sample(7.5, 7.5)).toBe(5);
  });

  it('builds the project room with its walls when the export comes with its lines', async () => {
    const repository = new Repository(new MemoryStorage());
    const walls = [
      ['0 0', '1 0'],
      ['1 0', '1 1'],
      ['1 1', '0 1'],
      ['0 1', '0 0'],
    ].map(([p1, p2]) => ({ Version: 3, foundationId: 'g', wall: { p1, p2 } }));
    const house = parseDamProject(
      JSON.stringify({
        Version: 11,
        width: 1,
        height: 1,
        terrainLayers: [{ terrain: bytesToBase64(new Uint8Array(terrain)) }],
        rooms: [{ Version: 4, foundationId: 'g', parts: ['0 0'] }],
        walls,
      }),
      'hut.dam',
    );
    const map = await saveImportedMap(repository, {
      name: 'Hut',
      image: { widthPx: 300, heightPx: 300 },
      calibration: { pxPerSquare: 100, rotationDeg: 0, offsetPx: { x: 0, y: 0 } },
      content,
      sources: { walls: [], portals: [] },
      project: house,
      writeImage: async (mapId) => ({
        asset: await repository.importMapAsset(mapId, 'hut.jpg', new Uint8Array([1])),
        widthPx: 300,
        heightPx: 300,
      }),
    });
    const loaded = await repository.load('map', { area: 'data', id: map.id });
    expect(loaded.rooms).toHaveLength(1);
    expect(loaded.walls).toMatchObject([{ closed: true, heightFt: 12 }]);
  });

  it('refuses a project that does not fit before writing any file', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const save = saveImportedMap(repository, {
      name: 'Tiny',
      image: { widthPx: 50, heightPx: 50 },
      calibration: { pxPerSquare: 100, rotationDeg: 0, offsetPx: { x: 0, y: 0 } },
      project: { ...project, width: 4 },
      writeImage: async (mapId) => ({
        asset: await repository.importMapAsset(mapId, 'tiny.jpg', new Uint8Array([1])),
        widthPx: 50,
        heightPx: 50,
      }),
    });
    await expect(save).rejects.toThrow(/"cellar.dam" is 4 × 1 squares, larger than the map/);
    expect(storage.files.data.size).toBe(0);
  });

  it('scales the grid to a picture stored reduced and keeps the squares', async () => {
    const repository = new Repository(new MemoryStorage());
    const map = await saveImportedMap(repository, {
      name: 'Huge',
      image: { widthPx: 1600, heightPx: 1200 },
      calibration: { pxPerSquare: 80, rotationDeg: 1.5, offsetPx: { x: 39, y: -78 } },
      writeImage: async (mapId) => ({
        asset: await repository.importMapAsset(mapId, 'huge.jpg', new Uint8Array([1])),
        widthPx: 400,
        heightPx: 300,
      }),
    });
    expect(map.image).toMatchObject({ widthPx: 400, heightPx: 300 });
    expect(map.grid).toMatchObject({
      pxPerSquare: 20,
      rotationDeg: 1.5,
      offsetPx: { x: 9.75, y: -19.5 },
      squaresX: 20,
      squaresY: 15,
    });
  });
});

describe('hasTransparency', () => {
  it('finds any pixel that is not fully opaque', () => {
    expect(hasTransparency(new Uint8ClampedArray([0, 0, 0, 255, 9, 9, 9, 255]))).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray([0, 0, 0, 255, 9, 9, 9, 254]))).toBe(true);
  });
});
