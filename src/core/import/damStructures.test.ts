import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../binary';
import { wallSegmentEnds } from '../geometry/walls';
import type { Vec2 } from '../model/common';
import type { BattleMap } from '../model/map';
import { parseDamProject } from './damProject';
import { fitWallTopScale, wallRuns, withDamStructures } from './damStructures';
import type { ImportedContent, StructureSources } from './importedMap';
import { FULL_WALL, type SourcePortal } from './mapStructures';

/** Flat terrain of `size` x `size` tiles at 0.2 tiles, the ground level's foundation height. */
function terrain(size: number): string {
  const n = size * 8 + 1;
  const buffer = new ArrayBuffer(20 + n * n * 4);
  new Int32Array(buffer, 0, 5).set([-1, 0, n, n, n * n]);
  new Float32Array(buffer, 20).fill(0.2);
  return bytesToBase64(new Uint8Array(buffer));
}

/** A 3 x 2 tile room with its south-west corner at tile (0, 0); tile y counts north. */
const ROOM_WALLS = [
  ['0 0', '1 0'],
  ['1 0', '2 0'],
  ['2 0', '3 0'],
  ['3 0', '3 1'],
  ['3 1', '3 2'],
  ['3 2', '2 2'],
  ['2 2', '1 2'],
  ['1 2', '0 2'],
  ['0 2', '0 1'],
  ['0 1', '0 0'],
];

function dam(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Version: 11,
    width: 4,
    height: 4,
    terrainLayers: [{ terrain: terrain(4) }],
    foundations: [
      { Version: 1, id: 'ground', height: 0.2, baseFoundationId: 'ground', foundationAboveId: 'upper' },
      { Version: 1, id: 'cellar', height: -2.2, layer: -1, baseFoundationId: 'cellar' },
      { Version: 1, id: 'upper', height: 2.6, layer: 1, baseFoundationId: 'ground' },
    ],
    rooms: [{ Version: 4, foundationId: 'ground', parts: ['0 0', '1 0', '2 0', '0 1', '1 1', '2 1'] }],
    walls: ROOM_WALLS.map(([p1, p2]) => ({ Version: 3, foundationId: 'ground', wall: { p1, p2 } })),
    wallOpenings: [
      { foundationId: 'ground', wallPieceSection: '1 0 2 0 0;0;1' },
      { foundationId: 'ground', wallPieceSection: '0 1 0 2 0;0;1' },
    ],
    pillars: [
      { Version: 3, foundationId: 'ground', position: { positionInCm: '0 0', offset: '-1 -1' } },
      { Version: 3, foundationId: 'ground', position: { positionInCm: '0 0', offset: '1 1' } },
      { Version: 3, foundationId: 'ground', position: { positionInCm: '300 350', offset: '-1 -1' } },
    ],
    ...extra,
  });
}

// The 4 x 4 tile project in a 6 x 6 square export: one square margin per side.
const GRID = { squaresX: 6, squaresY: 6, feetPerSquare: 5 };
const CENTRE = { x: 15, y: 15 };
const SCALE = 1.05;
/** Map feet of a tile corner: margin plus tile x east, margin plus (height - tile y) south. */
const at = (x: number, y: number): Vec2 => ({ x: (1 + x) * 5, y: (1 + 4 - y) * 5 });
const apparent = (p: Vec2): Vec2 => ({
  x: CENTRE.x + (p.x - CENTRE.x) * SCALE,
  y: CENTRE.y + (p.y - CENTRE.y) * SCALE,
});

const EMPTY: ImportedContent = { walls: [], openings: [], rooms: [], lights: [], ambientLight: 'bright', notes: '' };

/** What a Universal VTT export of the room draws: wall tops pushed outwards by the camera. */
function exportOfRoom(): StructureSources {
  const window: SourcePortal = {
    a: apparent(at(0, 1)),
    b: apparent(at(0, 2)),
    kind: 'window',
    state: 'closed',
    secret: false,
    profile: FULL_WALL,
  };
  return {
    walls: [
      { points: [at(0, 0), at(3, 0), at(3, 2), at(0, 2), at(0, 1)].map(apparent), profile: FULL_WALL },
      // A garden wall the project does not know.
      { points: [at(3.5, 3.8), at(3.9, 3.8)], profile: FULL_WALL },
    ],
    portals: [window],
  };
}

function openingCentre(map: Pick<BattleMap, 'walls' | 'openings'>, index: number): Vec2 {
  const opening = map.openings[index]!;
  const wall = map.walls.find((w) => w.id === opening.wallId)!;
  const [a, b] = wallSegmentEnds(wall)[opening.segment]!;
  return { x: a.x + (b.x - a.x) * opening.t, y: a.y + (b.y - a.y) * opening.t };
}

describe('parseDamProject buildings', () => {
  it('reads the ground level in feet from the north-west corner', () => {
    const { structure } = parseDamProject(dam(), 'house.dam');
    // Tile (0, 0) is the south-west corner of the 4 tile high project.
    expect(structure.walls[0]).toEqual({ a: { x: 0, y: 20 }, b: { x: 5, y: 20 } });
    expect(structure.openings).toEqual([
      { a: { x: 5, y: 20 }, b: { x: 10, y: 20 } },
      { a: { x: 0, y: 15 }, b: { x: 0, y: 10 } },
    ]);
    expect(structure.pillars).toEqual([
      { x: 0, y: 20 },
      { x: 15, y: 2.5 },
    ]);
    expect(structure).toMatchObject({ floorFt: 1, storeyFt: 12, otherLevelParts: 0 });
  });

  it('outlines rooms from their tiles, L shapes included', () => {
    const parts = ['0 0', '1 0', '0 1'];
    const { structure } = parseDamProject(dam({ rooms: [{ Version: 4, foundationId: 'ground', parts }] }), 'l.dam');
    expect(structure.rooms).toHaveLength(1);
    expect(new Set(structure.rooms[0]!.map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(['0,20', '10,20', '10,15', '5,15', '5,10', '0,10']),
    );
  });

  it('keeps a storey of 2.4 tiles without a level above and counts parts of other levels', () => {
    const { structure } = parseDamProject(
      dam({
        foundations: [{ id: 'ground', height: 0, baseFoundationId: 'ground', foundationAboveId: 'upper' }],
        rooms: [{ Version: 4, foundationId: 'upper', parts: ['0 0'] }],
      }),
      'tower.dam',
    );
    expect(structure).toMatchObject({ floorFt: 0, storeyFt: 12, rooms: [], otherLevelParts: 1 });
  });

  it('names an unknown layout of a building part', () => {
    expect(() =>
      parseDamProject(dam({ walls: [{ Version: 9, foundationId: 'ground', wall: {} }] }), 'new.dam'),
    ).toThrow(/"new.dam" is not a valid Dungeon Alchemist project \(walls\.0\.Version: /);
    expect(() =>
      parseDamProject(dam({ wallOpenings: [{ foundationId: 'ground', wallPieceSection: '1 0 2' }] }), 'odd.dam'),
    ).toThrow(/wallOpenings\.0\.wallPieceSection: expected "x1 y1 x2 y2 level;offset;width"/);
  });
});

describe('wallRuns', () => {
  it('joins touching colinear pieces and keeps corners apart', () => {
    const runs = wallRuns([
      { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 5, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 5 } },
      { a: { x: 20, y: 0 }, b: { x: 25, y: 0 } },
    ]);
    expect(runs).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 20, y: 0 }, b: { x: 25, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 5 } },
    ]);
  });
});

describe('withDamStructures', () => {
  const project = parseDamProject(dam(), 'house.dam');

  it('finds the scale at which the export shows the wall tops', () => {
    const runs = wallRuns(
      project.structure.walls.map((w) => ({ a: at(w.a.x / 5, 4 - w.a.y / 5), b: at(w.b.x / 5, 4 - w.b.y / 5) })),
    );
    expect(fitWallTopScale(runs, exportOfRoom(), CENTRE)).toBeCloseTo(SCALE, 3);
    expect(fitWallTopScale(runs, { walls: [], portals: [] }, CENTRE)).toBe(1);
  });

  it('replaces the export walls of the building with full height walls, a room and openings', () => {
    const content = withDamStructures(EMPTY, exportOfRoom(), project, GRID);
    const room = content.walls.find((w) => w.closed && w.heightFt === 12 && w.points.length === 4)!;
    expect(new Set(room.points.map((p) => `${p.x},${p.y}`))).toEqual(new Set(['5,25', '20,25', '20,15', '5,15']));
    expect(content.rooms).toMatchObject([{ name: 'Room 1', floorFt: 1, ceilingFt: 12, roof: false }]);
    expect(content.rooms[0]!.polygon).toHaveLength(4);
    // No export portal on the door: a door. The window takes the export's.
    expect(content.openings.map((o) => [o.kind, o.widthFt, o.wallId === room.id])).toEqual([
      ['door', 5, true],
      ['window', 5, true],
    ]);
    expect(openingCentre(content, 0)).toEqual({ x: 12.5, y: 25 });
    expect(openingCentre(content, 1)).toEqual({ x: 5, y: 17.5 });
  });

  it('keeps export walls that belong to nothing in the project and adds free pillars', () => {
    const content = withDamStructures(EMPTY, exportOfRoom(), project, GRID);
    const garden = content.walls.filter((w) => w.heightFt === 10);
    expect(garden).toHaveLength(1);
    expect(garden[0]!.points).toEqual([at(3.5, 3.8), at(3.9, 3.8)]);
    // The pillar at (3, 3.5) stands free; the corner one joins the walls.
    const pillar = content.walls.find((w) => w.closed && w.thicknessFt === 0.75)!;
    expect(pillar.points).toContainEqual({ x: 20 - 0.75, y: 7.5 - 0.75 });
    expect(content.walls).toHaveLength(3);
  });

  it('notes that upper floors stay out', () => {
    const upper = parseDamProject(
      dam({ rooms: [...JSON.parse(dam()).rooms, { Version: 4, foundationId: 'upper', parts: ['0 0'] }] }),
      'two.dam',
    );
    const content = withDamStructures({ ...EMPTY, notes: 'Baked.' }, exportOfRoom(), upper, GRID);
    expect(content.notes).toBe('Baked. Upper floors of the Dungeon Alchemist project are not imported yet.');
    expect(content.rooms).toHaveLength(1);
  });
});
