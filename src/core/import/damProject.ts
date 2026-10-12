import { z } from 'zod';
import { base64ToBytes } from '../binary';
import { cellOutline } from '../geometry/polygon';
import type { Vec2 } from '../model/common';
import type { Grid } from '../model/map';
import { HeightField } from '../terrain/heightfield';
import { parseJsonFile, parseOrThrow } from './importedMap';

// Dungeon Alchemist measures in tiles; one tile is one 5 ft square.
const FEET_PER_TILE = 5;
const SAMPLES_PER_TILE = 8;
const HEADER_INTS = 5;
// The two leading header ints of every terrain blob seen so far.
const TERRAIN_MARKER = [-1, 0];
// Level spacing of every multi-level project seen (foundations 0.2 and 2.6).
const DEFAULT_STOREY_TILES = 2.4;
const CM_PER_TILE = 100;

/** One placed Dungeon Alchemist object; the mesh behind `blockId` is Dungeon Alchemist's own. */
export interface DamObject {
  blockId: string;
  /** Feet from the project's north-west corner. */
  position: Vec2;
  /** Base elevation in feet. */
  elevationFt: number;
  /** Clockwise turn seen from above with north up. */
  rotationDeg: number;
  scale: number;
}

/** A wall or opening between two points, in feet from the project's north-west corner. */
export interface DamSpan {
  a: Vec2;
  b: Vec2;
}

/** Buildings on the ground level, in feet from the project's north-west corner. */
export interface DamStructure {
  /** One entry per wall piece (one tile edge); openings cut into these. */
  walls: DamSpan[];
  openings: DamSpan[];
  /** Outline of each room's floor tiles. */
  rooms: Vec2[][];
  /** Wall corner posts, one per position. */
  pillars: Vec2[];
  /** Absolute floor elevation of the ground level. */
  floorFt: number;
  /** Floor to floor height, the height of a full wall. */
  storeyFt: number;
  /** Rooms, walls, openings and objects on other levels, which are not read. */
  otherLevelParts: number;
}

/** What this app reads from a Dungeon Alchemist project file (`.dam`). */
export interface DamProject {
  fileName: string;
  version: number;
  /** Size in squares, without the margin exports add around it. */
  width: number;
  height: number;
  /** Ground heights in feet from the project's north-west corner. */
  terrain: HeightField;
  objects: DamObject[];
  structure: DamStructure;
}

/** "x y" in tiles, x east and y north. */
const tilePoint = z
  .string()
  .regex(/^-?\d+(\.\d+)? -?\d+(\.\d+)?$/, 'expected "x y"')
  .transform((s) => {
    const [x, y] = s.split(' ').map(Number) as [number, number];
    return { x, y };
  });

/** "x1 y1 x2 y2 level;offset;width": a run of `width` wall pieces from p1 towards p2. */
const pieceSection = z
  .string()
  .regex(/^(-?\d+ ){4}-?\d+;\d+;\d+$/, 'expected "x1 y1 x2 y2 level;offset;width"')
  .transform((s) => {
    const [ends, offset, width] = s.split(';') as [string, string, string];
    const [x1, y1, x2, y2] = ends.split(' ').map(Number) as [number, number, number, number];
    return { p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, offset: Number(offset), width: Number(width) };
  });

const version11Schema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  terrainLayers: z.array(z.object({ terrain: z.string().min(1) })).min(1),
  buildingBlockInstances: z
    .array(
      z.object({
        id: z.string().min(1),
        blockId: z.string().min(1),
        center: z.object({ x: z.number(), y: z.number() }),
        height: z.number(),
        // Objects Dungeon Alchemist never turned have no rotation.
        rotation: z.number().default(0),
        scale: z.number().positive(),
      }),
    )
    .default([]),
  /** Placed objects; building blocks of walls, floors and pillars are not listed here. */
  objects: z.array(z.object({ foundationId: z.string(), buildingBlockInstanceId: z.string() })).default([]),
  foundations: z
    .array(
      z.object({
        id: z.string(),
        height: z.number(),
        layer: z.number().int().default(0),
        baseFoundationId: z.string(),
        foundationAboveId: z.string().optional(),
      }),
    )
    .default([]),
  rooms: z
    .array(z.object({ Version: z.literal(4), foundationId: z.string(), parts: z.array(tilePoint).min(1) }))
    .default([]),
  walls: z
    .array(
      z.object({
        Version: z.literal(3),
        foundationId: z.string(),
        wall: z.object({ p1: tilePoint, p2: tilePoint }),
      }),
    )
    .default([]),
  wallOpenings: z.array(z.object({ foundationId: z.string(), wallPieceSection: pieceSection })).default([]),
  pillars: z
    .array(
      z.object({
        Version: z.literal(3),
        foundationId: z.string(),
        position: z.object({ positionInCm: tilePoint }),
      }),
    )
    .default([]),
});

type Version11 = z.infer<typeof version11Schema>;

/**
 * Heights of one terrain layer: five little-endian int32 (-1, 0, columns, rows, count), then
 * `count` float32 heights in tiles, row by row from the south edge, eight samples per tile.
 */
export function decodeDamTerrain(base64: string, width: number, height: number, fileName: string): HeightField {
  const bytes = base64ToBytes(base64);
  const cols = width * SAMPLES_PER_TILE + 1;
  const rows = height * SAMPLES_PER_TILE + 1;
  const header = bytes.length >= HEADER_INTS * 4 ? [...new Int32Array(bytes.buffer, 0, HEADER_INTS)] : [];
  const expected = [...TERRAIN_MARKER, cols, rows, cols * rows];
  if (header.join() !== expected.join() || bytes.length !== (HEADER_INTS + cols * rows) * 4) {
    throw new Error(
      `"${fileName}" has terrain data this app cannot read (header ${header.join(', ') || 'missing'}, ` +
        `expected ${expected.join(', ')} for ${width} × ${height} squares)`,
    );
  }
  const source = new Float32Array(bytes.buffer, HEADER_INTS * 4, cols * rows);
  const data = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const from = (rows - 1 - row) * cols;
    for (let col = 0; col < cols; col++) {
      data[row * cols + col] = source[from + col]! * FEET_PER_TILE;
    }
  }
  return new HeightField(cols, rows, FEET_PER_TILE / SAMPLES_PER_TILE, data);
}

/** Ground level: the foundation that is its own base on layer 0 (lower layers are cellars). */
function groundFoundation(project: Version11): Version11['foundations'][number] | null {
  return project.foundations.find((f) => f.layer === 0 && f.baseFoundationId === f.id) ?? null;
}

function readVersion11(doc: unknown, fileName: string, version: number): DamProject {
  const project = parseOrThrow(version11Schema, doc, fileName, 'Dungeon Alchemist project');
  const { width, height } = project;
  const ground = groundFoundation(project);
  const onGround = <T extends { foundationId: string }>(items: T[]) =>
    items.filter((item) => ground === null || item.foundationId === ground.id);
  const toFeet = (p: Vec2): Vec2 => ({ x: p.x * FEET_PER_TILE, y: (height - p.y) * FEET_PER_TILE });
  const instances = new Map(project.buildingBlockInstances.map((b) => [b.id, b]));
  const placed = onGround(project.objects).flatMap((o) => instances.get(o.buildingBlockInstanceId) ?? []);
  const above = project.foundations.find((f) => f.id === ground?.foundationAboveId);
  const levelParts: { foundationId: string }[][] = [
    project.rooms,
    project.walls,
    project.wallOpenings,
    project.objects,
  ];
  const pillars = new Map(
    onGround(project.pillars).map(({ position: { positionInCm: cm } }) => [
      `${cm.x} ${cm.y}`,
      toFeet({ x: cm.x / CM_PER_TILE, y: cm.y / CM_PER_TILE }),
    ]),
  );
  return {
    fileName,
    version,
    width,
    height,
    // The first layer is the ground; the second repeats it 0.1 tiles lower.
    terrain: decodeDamTerrain(project.terrainLayers[0]!.terrain, width, height, fileName),
    objects: placed.map((b) => ({
      blockId: b.blockId,
      position: toFeet(b.center),
      elevationFt: b.height * FEET_PER_TILE,
      rotationDeg: b.rotation,
      scale: b.scale,
    })),
    structure: {
      walls: onGround(project.walls).map(({ wall }) => ({ a: toFeet(wall.p1), b: toFeet(wall.p2) })),
      openings: onGround(project.wallOpenings).map(({ wallPieceSection: { p1, p2, offset, width: pieces } }) => {
        const step = { x: Math.sign(p2.x - p1.x), y: Math.sign(p2.y - p1.y) };
        const start = { x: p1.x + step.x * offset, y: p1.y + step.y * offset };
        const end = { x: start.x + step.x * pieces, y: start.y + step.y * pieces };
        return { a: toFeet(start), b: toFeet(end) };
      }),
      rooms: onGround(project.rooms).map((room) => cellOutline(room.parts).map(toFeet)),
      pillars: [...pillars.values()],
      // Hundredths drop float noise such as 2.60000014 tiles.
      floorFt: Math.round((ground?.height ?? 0) * FEET_PER_TILE * 100) / 100,
      storeyFt:
        Math.round((above && ground ? above.height - ground.height : DEFAULT_STOREY_TILES) * FEET_PER_TILE * 100) / 100,
      otherLevelParts: levelParts.reduce((n, list) => n + list.length - onGround(list).length, 0),
    },
  };
}

const READERS: Record<number, (doc: unknown, fileName: string, version: number) => DamProject> = {
  11: readVersion11,
};

/** Reads terrain, ground-level buildings and object placements of a `.dam` file; unknown versions throw. */
export function parseDamProject(text: string, fileName: string): DamProject {
  const doc = parseJsonFile(text, fileName);
  const { Version: version } = parseOrThrow(
    z.object({ Version: z.number().int() }),
    doc,
    fileName,
    'Dungeon Alchemist project',
  );
  const reader = READERS[version];
  if (!reader) {
    const known = Object.keys(READERS).join(', ');
    throw new Error(`"${fileName}" is a Dungeon Alchemist project of version ${version}; this app reads ${known}`);
  }
  return reader(doc, fileName, version);
}

/** Squares between the map edge and the project area: exports add the same margin on both sides. */
export function damMargin(project: DamProject, grid: Pick<Grid, 'squaresX' | 'squaresY'>): Vec2 {
  const margin = { x: (grid.squaresX - project.width) / 2, y: (grid.squaresY - project.height) / 2 };
  if (margin.x < 0 || margin.y < 0) {
    throw new Error(
      `"${project.fileName}" is ${project.width} × ${project.height} squares, larger than the map ` +
        `(${grid.squaresX} × ${grid.squaresY}); pick the project the export came from`,
    );
  }
  return margin;
}

/** The project's ground on the map's height grid; the export margin repeats the nearest edge. */
export function damTerrainField(project: DamProject, grid: Grid, samplesPerSquare: number): HeightField {
  const margin = damMargin(project, grid);
  const field = HeightField.empty(grid, samplesPerSquare);
  const shift = { x: margin.x * grid.feetPerSquare, y: margin.y * grid.feetPerSquare };
  for (let row = 0; row < field.rows; row++) {
    for (let col = 0; col < field.cols; col++) {
      const x = col * field.spacingFt - shift.x;
      const y = row * field.spacingFt - shift.y;
      field.data[field.index(col, row)] = project.terrain.sample(x, y);
    }
  }
  return field;
}
