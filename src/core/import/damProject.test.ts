import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../binary';
import { createMap } from '../model/factories';
import { damMargin, damTerrainField, decodeDamTerrain, parseDamProject } from './damProject';
import { damObjectKinds, damProps } from './damObjects';

/** Terrain blob of `width` x `height` tiles; the height in tiles is row * 10 + column, rows from the south. */
function terrain(width: number, height: number, header?: number[]): string {
  const cols = width * 8 + 1;
  const rows = height * 8 + 1;
  const buffer = new ArrayBuffer(20 + cols * rows * 4);
  new Int32Array(buffer, 0, 5).set(header ?? [-1, 0, cols, rows, cols * rows]);
  const values = new Float32Array(buffer, 20);
  values.forEach((_, i) => (values[i] = Math.floor(i / cols) * 10 + (i % cols)));
  return bytesToBase64(new Uint8Array(buffer));
}

function project(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Version: 11,
    width: 1,
    height: 1,
    origin: { x: 0.5, y: 0.5 },
    terrainLayers: [{ terrain: terrain(1, 1), waterMap: '9 9 ' }],
    buildingBlockInstances: [
      { Version: 11, id: 'i1', blockId: 'tree', center: { x: 0.25, y: 0.75 }, height: 0.5, scale: 1.2, rotation: 30 },
      { Version: 11, id: 'i2', blockId: 'rock', center: { x: 0.5, y: 0.5 }, height: 0, scale: 1 },
      { Version: 11, id: 'i3', blockId: 'tree', center: { x: 0.75, y: 0.25 }, height: 0, scale: 1, rotation: 0 },
      // A wall's building block is no object.
      { Version: 11, id: 'w1', blockId: 'wall', center: { x: 0, y: 0.5 }, height: 0, scale: 1, rotation: 90 },
    ],
    objects: ['i1', 'i2', 'i3'].map((id) => ({ foundationId: 'ground', buildingBlockInstanceId: id })),
    foundations: [{ id: 'ground', height: 0, baseFoundationId: 'ground' }],
    ...extra,
  });
}

describe('decodeDamTerrain', () => {
  it('reads tile heights as feet with the north edge first', () => {
    const field = decodeDamTerrain(terrain(1, 1), 1, 1, 'a.dam');
    expect([field.cols, field.rows, field.spacingFt]).toEqual([9, 9, 0.625]);
    // North-west sample is the last stored row (row 8 from the south), column 0.
    expect(field.at(0, 0)).toBe(80 * 5);
    expect(field.at(3, 8)).toBe(3 * 5);
  });

  it('refuses blobs with an unknown header or the wrong size', () => {
    expect(() => decodeDamTerrain(terrain(1, 1, [7, 0, 9, 9, 81]), 1, 1, 'a.dam')).toThrow(
      /"a.dam" has terrain data this app cannot read \(header 7, 0, 9, 9, 81, expected -1, 0, 9, 9, 81/,
    );
    expect(() => decodeDamTerrain(terrain(1, 1), 2, 1, 'a.dam')).toThrow(/for 2 × 1 squares/);
  });
});

describe('parseDamProject', () => {
  it('reads version 11 terrain and object placements in feet from the north-west corner', () => {
    const dam = parseDamProject(project(), 'forest.dam');
    expect(dam).toMatchObject({ fileName: 'forest.dam', version: 11, width: 1, height: 1 });
    expect(dam.objects[0]).toEqual({
      blockId: 'tree',
      position: { x: 1.25, y: 1.25 },
      elevationFt: 2.5,
      rotationDeg: 30,
      scale: 1.2,
    });
    expect(damObjectKinds(dam)).toEqual([
      { blockId: 'tree', count: 2 },
      { blockId: 'rock', count: 1 },
    ]);
  });

  it('refuses unknown versions and broken files by name', () => {
    expect(() => parseDamProject(project({ Version: 12 }), 'new.dam')).toThrow(
      /"new.dam" is a Dungeon Alchemist project of version 12; this app reads 11/,
    );
    expect(() => parseDamProject('{"width": 3}', 'odd.dam')).toThrow(
      /"odd.dam" is not a valid Dungeon Alchemist project/,
    );
    expect(() => parseDamProject('nope', 'bad.dam')).toThrow(/"bad.dam" is not JSON/);
  });
});

describe('Dungeon Alchemist terrain and objects on a map', () => {
  const dam = parseDamProject(project(), 'forest.dam');
  // Exports add the same border around the project: 1 square here, 4 in Dungeon Alchemist's default.
  const map = createMap({ name: 'Forest', image: null, squaresX: 3, squaresY: 3, pxPerSquare: 100 });

  it('places the project in the middle of the export and repeats its edge in the border', () => {
    expect(damMargin(dam, map.grid)).toEqual({ x: 1, y: 1 });
    const field = damTerrainField(dam, map.grid, 4);
    expect([field.cols, field.rows]).toEqual([13, 13]);
    // Map point (5 ft, 5 ft) is the project's north-west corner.
    expect(field.sample(5, 5)).toBe(80 * 5);
    expect(field.sample(7.5, 7.5)).toBe((40 + 4) * 5);
    expect(field.sample(10, 10)).toBe(8 * 5);
    expect(field.sample(0, 0)).toBe(80 * 5);
  });

  it('refuses a project larger than the map', () => {
    const small = createMap({ name: 'Small', image: null, squaresX: 1, squaresY: 1, pxPerSquare: 100 });
    const big = parseDamProject(project({ width: 2, terrainLayers: [{ terrain: terrain(2, 1) }] }), 'big.dam');
    expect(() => damMargin(big, small.grid)).toThrow(/"big.dam" is 2 × 1 squares, larger than the map \(1 × 1\)/);
  });

  it('turns placements into props with the chosen models; skipped kinds stay out', () => {
    const model = { area: 'data' as const, path: 'library/maps/m/assets/models/cc0/tree.glb' };
    const props = damProps(dam, { x: 1, y: 1 }, 5, {
      tree: { name: 'Pine', model, unitFt: 2, rotationDeg: 15 },
    });
    expect(props).toHaveLength(2);
    expect(props[0]).toMatchObject({
      name: 'Pine',
      asset: model,
      position: [6.25, 2.5, 6.25],
      rotationDeg: [0, -45, 0],
      scale: [2.4, 2.4, 2.4],
      occludesSight: false,
      blocksMovement: false,
    });
  });
});
