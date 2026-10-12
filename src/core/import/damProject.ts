import { z } from 'zod';
import { base64ToBytes } from '../binary';
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
}

const version11Schema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  terrainLayers: z.array(z.object({ terrain: z.string().min(1) })).min(1),
  buildingBlockInstances: z
    .array(
      z.object({
        blockId: z.string().min(1),
        center: z.object({ x: z.number(), y: z.number() }),
        height: z.number(),
        scale: z.number().positive(),
        rotation: z.number(),
      }),
    )
    .default([]),
});

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

function readVersion11(doc: unknown, fileName: string, version: number): DamProject {
  const project = parseOrThrow(version11Schema, doc, fileName, 'Dungeon Alchemist project');
  const { width, height } = project;
  return {
    fileName,
    version,
    width,
    height,
    // The first layer is the ground; the second repeats it 0.1 tiles lower.
    terrain: decodeDamTerrain(project.terrainLayers[0]!.terrain, width, height, fileName),
    objects: project.buildingBlockInstances.map((b) => ({
      blockId: b.blockId,
      position: { x: b.center.x * FEET_PER_TILE, y: (height - b.center.y) * FEET_PER_TILE },
      elevationFt: b.height * FEET_PER_TILE,
      rotationDeg: b.rotation,
      scale: b.scale,
    })),
  };
}

const READERS: Record<number, (doc: unknown, fileName: string, version: number) => DamProject> = {
  11: readVersion11,
};

/** Reads terrain and object placements of a `.dam` file; unknown versions throw. */
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
