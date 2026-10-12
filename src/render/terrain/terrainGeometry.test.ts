import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { raiseBrush } from '@/core/terrain/brushes';
import { HeightField } from '@/core/terrain/heightfield';
import { createTerrainGeometry, updateTerrainGeometry, updateTerrainRegion } from './terrainGeometry';

describe('terrain geometry', () => {
  it('triangulates every grid cell plus the border skirt', () => {
    const geometry = createTerrainGeometry(new HeightField(3, 3, 5));
    // 2x2 cells * 2 triangles + 8 border segments * 2 skirt triangles
    expect(geometry.index!.count).toBe((8 + 16) * 3);
  });

  it('gives the flat surface upward normals and the skirt horizontal ones', () => {
    const geometry = createTerrainGeometry(new HeightField(3, 3, 5));
    const normal = geometry.getAttribute('normal');
    expect(normal.getY(4)).toBeCloseTo(1, 6);
    expect(Math.abs(normal.getY(9))).toBeLessThan(0.01);
  });

  it('writes new heights in place and drops the skirt below the lowest point', () => {
    const field = new HeightField(3, 3, 5);
    const geometry = createTerrainGeometry(field);
    field.data[4] = 7;
    field.data[0] = -2;
    updateTerrainGeometry(geometry, field);
    const position = geometry.getAttribute('position');
    expect(position.getY(4)).toBe(7);
    expect(position.getX(4)).toBe(5);
    expect(position.getZ(4)).toBe(5);
    expect(position.getY(position.count - 1)).toBe(-5);
  });
});

describe('terrain region update', () => {
  function bumpyField(): HeightField {
    const field = new HeightField(40, 30, 1.25);
    field.data.forEach((_, i) => (field.data[i] = Math.sin(i * 0.7) * 2));
    return field;
  }

  it('writes the same surface positions and normals as a full update', () => {
    const field = bumpyField();
    const partial = createTerrainGeometry(field);
    const rect = raiseBrush(field, { center: { x: 10, y: 8 }, radiusFt: 4, falloff: 'smooth' }, 6)!;
    updateTerrainRegion(partial, field, rect);
    const full = createTerrainGeometry(field);
    const surface = field.cols * field.rows * 3;
    for (const name of ['position', 'normal']) {
      const a = (partial.getAttribute(name) as BufferAttribute).array as Float32Array;
      const b = (full.getAttribute(name) as BufferAttribute).array as Float32Array;
      const worst = a.subarray(0, surface).reduce((max, v, i) => Math.max(max, Math.abs(v - b[i]!)), 0);
      expect(worst, name).toBeLessThan(1e-5);
    }
  });

  it('refits the BVH so raycasts hit raised terrain from the side', () => {
    const field = new HeightField(40, 40, 1.25);
    const geometry = createTerrainGeometry(field);
    const rect = raiseBrush(field, { center: { x: 25, y: 25 }, radiusFt: 5, falloff: 'constant' }, 10)!;
    updateTerrainRegion(geometry, field, rect);
    const raycaster = new Raycaster(new Vector3(-10, 5, 25), new Vector3(1, 0, 0));
    const hit = raycaster.intersectObject(new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })))[0];
    expect(hit?.point.x).toBeGreaterThan(19);
    expect(hit?.point.x).toBeLessThan(21);
    expect(geometry.boundingBox!.max.y).toBe(10);
  });

  it('deepens the skirt and refits its BVH nodes when a dab digs below the lowest point', () => {
    const field = new HeightField(40, 40, 1.25);
    const geometry = createTerrainGeometry(field);
    const rect = raiseBrush(field, { center: { x: 25, y: 25 }, radiusFt: 5, falloff: 'constant' }, -20)!;
    updateTerrainRegion(geometry, field, rect);
    const raycaster = new Raycaster(new Vector3(-10, -10, 10), new Vector3(1, 0, 0));
    const hit = raycaster.intersectObject(new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })))[0];
    expect(hit?.point.x).toBeCloseTo(0, 6);
    expect(geometry.boundingBox!.min.y).toBe(-23);
  });
});
