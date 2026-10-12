import { describe, expect, it } from 'vitest';
import { createMap } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { snapTokenPoint } from './tokenPlacement';

const map = createMap({ name: 'm', image: null, squaresX: 6, squaresY: 4, pxPerSquare: 70 });
const terrain = HeightField.fromMap(map);

describe('snapTokenPoint', () => {
  it('puts one-square creatures on square centres', () => {
    expect(snapTokenPoint({ x: 9.9, y: 0.2 }, 'medium', map.grid, terrain)).toEqual({ x: 7.5, y: 2.5, elevationFt: 0 });
    expect(snapTokenPoint({ x: 10.1, y: 4 }, 'tiny', map.grid, terrain)).toMatchObject({ x: 12.5, y: 2.5 });
  });

  it('puts two-square creatures on grid corners', () => {
    expect(snapTokenPoint({ x: 11, y: 9 }, 'large', map.grid, terrain)).toMatchObject({ x: 10, y: 10 });
  });

  it('keeps the footprint on the map', () => {
    expect(snapTokenPoint({ x: 29, y: -3 }, 'huge', map.grid, terrain)).toMatchObject({ x: 22.5, y: 7.5 });
  });

  it('takes the elevation from the terrain', () => {
    const hill = terrain.clone();
    hill.data.fill(6);
    expect(snapTokenPoint({ x: 3, y: 3 }, 'small', map.grid, hill).elevationFt).toBe(6);
  });
});
