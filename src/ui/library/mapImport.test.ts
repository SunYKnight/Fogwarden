import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import {
  cornerGesture,
  createCalibratedMap,
  gridFromFileName,
  guessCalibration,
  mapNameFromFileName,
  roundCalibration,
} from './mapImport';

describe('map import helpers', () => {
  it('reads the square count and a readable name from the file name', () => {
    expect(gridFromFileName('52x49_tavern.jpg')).toEqual({ squaresX: 52, squaresY: 49 });
    expect(gridFromFileName('tavern.jpg')).toBeNull();
    expect(mapNameFromFileName('52x49_old__tavern.jpg')).toBe('52x49 old tavern');
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
