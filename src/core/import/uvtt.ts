import { z } from 'zod';
import { base64ToBytes } from '../binary';
import { newId, type Vec2 } from '../model/common';
import type { MapLight } from '../model/map';
import {
  bakedLighting,
  lightLevelOfColor,
  parseHexColor,
  parseJsonFile,
  parseOrThrow,
  sniffImage,
  type ImageExtension,
  type ImportedMap,
} from './importedMap';
import { buildStructures, FULL_WALL, type SourcePortal, type SourceWall, type WallProfile } from './mapStructures';

/** File extensions of the Universal VTT format (Dungeondraft, Dungeon Alchemist, DungeonFog, Arkenforge). */
const UVTT_EXTENSIONS = ['dd2vtt', 'df2vtt', 'uvtt'] as const;

const FEET_PER_SQUARE = 5;
// Same height as the light tool puts a flame above the ground.
const LIGHT_HEIGHT_FT = 5;

/**
 * `objects_line_of_sight` outlines furniture, pillars and trees that block sight. A wall lower
 * than a room wall but above medium eye height (5 ft) blocks sight the same way and shows the
 * object is no room wall.
 */
const SIGHT_OBJECT: WallProfile = {
  heightFt: 6,
  thicknessFt: 0.5,
  blocksSight: true,
  blocksMovement: true,
  blocksLight: true,
};

const pointSchema = z.object({ x: z.number(), y: z.number() });
const polylinesSchema = z.array(z.array(pointSchema));

const uvttSchema = z.object({
  format: z.number().optional(),
  resolution: z.object({
    map_origin: pointSchema.default({ x: 0, y: 0 }),
    map_size: pointSchema,
    pixels_per_grid: z.number().positive(),
  }),
  line_of_sight: polylinesSchema.default([]),
  objects_line_of_sight: polylinesSchema.default([]),
  portals: z.array(z.object({ bounds: z.array(pointSchema).min(2), closed: z.boolean().default(true) })).default([]),
  environment: z
    .object({ baked_lighting: z.boolean().default(false), ambient_light: z.string().optional() })
    .default({ baked_lighting: false }),
  lights: z
    .array(
      z.object({
        position: pointSchema,
        range: z.number().nonnegative(),
        color: z.string().optional(),
      }),
    )
    .default([]),
  image: z.string().min(1),
});

export interface UvttMap extends ImportedMap {
  image: { bytes: Uint8Array<ArrayBuffer>; extension: ImageExtension };
}

export function isUvttFileName(name: string): boolean {
  return new RegExp(`\\.(${UVTT_EXTENSIONS.join('|')})$`, 'i').test(name);
}

/**
 * Reads a Universal VTT export: positions in squares from `map_origin` become feet from the map's
 * north-west corner, the base64 picture becomes image bytes.
 */
export function parseUvtt(text: string, fileName: string): UvttMap {
  const file = parseOrThrow(uvttSchema, parseJsonFile(text, fileName), fileName, 'Universal VTT file');
  const { map_origin: origin, pixels_per_grid: pxPerSquare } = file.resolution;
  const toFeet = (p: Vec2) => ({ x: (p.x - origin.x) * FEET_PER_SQUARE, y: (p.y - origin.y) * FEET_PER_SQUARE });
  const bytes = base64ToBytes(file.image.replace(/^data:[^,]*,/, ''));
  const extension = sniffImage(bytes);
  if (extension === null) {
    throw new Error(`"${fileName}" holds an image that is not PNG, JPEG or WebP`);
  }
  // Dungeondraft marks portals that let light through (windows) open.
  const portals: SourcePortal[] = file.portals.map((p) => ({
    a: toFeet(p.bounds[0]!),
    b: toFeet(p.bounds.at(-1)!),
    kind: p.closed ? 'door' : 'window',
    state: 'closed',
    secret: false,
    profile: FULL_WALL,
  }));
  const walls: SourceWall[] = [
    ...file.line_of_sight.map((line) => ({ points: line.map(toFeet), profile: FULL_WALL })),
    ...file.objects_line_of_sight.map((line) => ({ points: line.map(toFeet), profile: SIGHT_OBJECT })),
  ];
  const lights = file.lights.map((l, i): MapLight => ({
    id: newId(),
    name: `Light ${i + 1}`,
    position: { ...toFeet(l.position), elevationFt: LIGHT_HEIGHT_FT },
    // The range is the full reach; half of it bright follows the 5e torch.
    brightFt: (l.range * FEET_PER_SQUARE) / 2,
    dimFt: (l.range * FEET_PER_SQUARE) / 2,
    color: l.color === undefined ? '#ffffff' : parseHexColor(l.color),
    enabled: true,
    attachedTo: null,
  }));
  const ambient = file.environment.ambient_light;
  const level = ambient === undefined ? 'bright' : lightLevelOfColor(parseHexColor(ambient));
  const lighting = file.environment.baked_lighting ? bakedLighting(level) : { ambientLight: level, notes: '' };
  return {
    calibration: { pxPerSquare, rotationDeg: 0, offsetPx: { x: 0, y: 0 } },
    content: { ...buildStructures(walls, portals), rooms: [], lights, ...lighting },
    sources: { walls, portals },
    image: { bytes, extension },
  };
}
