import { describe, expect, it } from 'vitest';
import { createMap } from '../model/factories';
import { HeightField } from './heightfield';

describe('HeightField', () => {
  it('sizes the field from the grid and samples per square', () => {
    const map = createMap({ name: 'm', image: null, squaresX: 3, squaresY: 2, pxPerSquare: 70 });
    const field = HeightField.fromMap(map);
    expect([field.cols, field.rows, field.spacingFt]).toEqual([13, 9, 1.25]);
    expect([field.widthFt, field.depthFt]).toEqual([15, 10]);
  });

  it('interpolates bilinearly between samples', () => {
    const field = new HeightField(2, 2, 5, new Float32Array([0, 10, 20, 30]));
    expect(field.sample(2.5, 0)).toBe(5);
    expect(field.sample(0, 2.5)).toBe(10);
    expect(field.sample(2.5, 2.5)).toBe(15);
  });

  it('clamps points outside the field to the border', () => {
    const field = new HeightField(2, 2, 5, new Float32Array([0, 10, 20, 30]));
    expect(field.sample(-100, -100)).toBe(0);
    expect(field.sample(100, 100)).toBe(30);
  });

  it('round-trips through the map document encoding', () => {
    const map = createMap({ name: 'm', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
    const field = HeightField.fromMap(map);
    field.data[field.index(4, 3)] = 7.5;
    const restored = HeightField.fromMap({ ...map, terrain: { ...map.terrain, heights: field.encode() } });
    expect(restored.at(4, 3)).toBe(7.5);
  });

  it('rejects stored heights that do not match the grid', () => {
    const map = createMap({ name: 'm', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
    const other = createMap({ name: 'o', image: null, squaresX: 3, squaresY: 2, pxPerSquare: 70 });
    expect(() => HeightField.fromMap({ ...map, terrain: other.terrain })).toThrow(/needs 81 samples/);
  });
});
