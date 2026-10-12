import { describe, expect, it } from 'vitest';
import { createMap } from '../model/factories';
import { HeightField } from './heightfield';
import { resampleHeightField } from './resample';

describe('resampleHeightField', () => {
  const map = createMap({ name: 'm', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
  // 10x10 ft at 4 samples per square: east-rising slope of 0.5 ft per ft.
  const slope = HeightField.fromMap(map);
  for (let r = 0; r < slope.rows; r++) {
    for (let c = 0; c < slope.cols; c++) slope.data[slope.index(c, r)] = 0.5 * c * slope.spacingFt;
  }

  it('keeps a slope at its map position when the resolution changes', () => {
    const coarse = resampleHeightField(slope, map.grid, 2);
    expect([coarse.cols, coarse.rows, coarse.spacingFt]).toEqual([5, 5, 2.5]);
    for (let c = 0; c < coarse.cols; c++) {
      expect(coarse.at(c, 3)).toBeCloseTo(0.5 * c * 2.5, 6);
    }
    const fine = resampleHeightField(slope, map.grid, 8);
    expect(fine.sample(3.125, 7)).toBeCloseTo(1.5625, 6);
  });

  it('keeps the slope when the map grows and continues the border beyond it', () => {
    const grown = resampleHeightField(slope, { ...map.grid, squaresX: 3, squaresY: 3 }, 4);
    expect([grown.cols, grown.rows]).toEqual([13, 13]);
    expect(grown.sample(7.5, 2.5)).toBeCloseTo(3.75, 6);
    expect(grown.at(12, 12)).toBe(5);
    expect(grown.at(8, 12)).toBe(5);
  });

  it('crops when the map shrinks', () => {
    const shrunk = resampleHeightField(slope, { ...map.grid, squaresX: 1 }, 4);
    expect([shrunk.cols, shrunk.rows]).toEqual([5, 9]);
    expect(shrunk.at(4, 0)).toBe(2.5);
  });
});
