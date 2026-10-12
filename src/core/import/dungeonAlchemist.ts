import { z } from 'zod';
import { newId, type Vec2 } from '../model/common';
import type { MapImage, MapLight } from '../model/map';
import { bakedLighting, parseHexColor, parseJsonFile, parseOrThrow, type ImportedMap } from './importedMap';
import { buildStructures, FULL_WALL, type SourcePortal, type SourceWall, type WallProfile } from './mapStructures';

const FEET_PER_SQUARE = 5;
// Same height as the light tool puts a flame above the ground.
const LIGHT_HEIGHT_FT = 5;
// Older Dungeon Alchemist builds suffix floors "-_NN", current ones "_NN".
const FLOOR_SUFFIX = /(?:-_|_)(\d{2})$/;
// Dungeon Alchemist appends this to the map name in Foundry exports.
const EXPORT_SUFFIX = /\s*-\s*Foundry_Export$/i;
// Preferred picture when one floor ships several.
const IMAGE_PRIORITY = ['webp', 'png', 'jpg', 'jpeg'];

/** Foundry wall sense: 0 none, 1 normal, 2 limited (seen past one such wall, not two). */
const SENSE: Record<0 | 1 | 2, Omit<WallProfile, 'blocksMovement'>> = {
  // Railings and fences: they stop feet, not eyes, and stay low.
  0: { heightFt: 3, thicknessFt: 0.5, blocksSight: false, blocksLight: false },
  1: { heightFt: 10, thicknessFt: 1, blocksSight: true, blocksLight: true },
  // A low sight blocker hides what is behind it from small creatures only, the
  // closest the height model gets to Foundry's limited sight.
  2: { heightFt: 3, thicknessFt: 0.5, blocksSight: true, blocksLight: true },
};

const DOOR_STATE = { 0: 'closed', 1: 'open', 2: 'locked' } as const;

const flag = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const sceneSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  grid: z.number().positive(),
  shiftX: z.number().default(0),
  shiftY: z.number().default(0),
  gridDistance: z.number().positive().default(5),
  padding: z.number().min(0).default(0),
  globalLight: z.boolean().default(true),
  darkness: z.number().min(0).max(1).default(0),
  lights: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        dim: z.number().nonnegative(),
        bright: z.number().nonnegative(),
        tintColor: z.string().nullish(),
      }),
    )
    .default([]),
  walls: z
    .array(
      z.object({
        c: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        move: z.number().default(1),
        sense: flag.default(1),
        door: flag.default(0),
        ds: flag.default(0),
      }),
    )
    .default([]),
});

export interface DaFloorFiles {
  /** Floor number from the file name, 0 for the ground floor or a single-floor export. */
  index: number;
  json: string;
  image: string;
}

export interface DaMapFiles {
  name: string;
  floors: DaFloorFiles[];
  /** Project file (`.dam`) whose name starts the export's name, if the folder has one. */
  project: string | null;
}

export interface DaFloor extends ImportedMap {
  image: Pick<MapImage, 'widthPx' | 'heightPx'>;
}

function splitName(fileName: string): { stem: string; extension: string } {
  const dot = fileName.lastIndexOf('.');
  return dot < 0
    ? { stem: fileName, extension: '' }
    : { stem: fileName.slice(0, dot), extension: fileName.slice(dot + 1).toLowerCase() };
}

/**
 * Groups a Dungeon Alchemist Foundry export folder into maps: every `<name>[_NN].json` needs a
 * picture with the same name. Other files are ignored. Throws naming a JSON file without picture.
 */
export function collectDaMaps(fileNames: string[]): DaMapFiles[] {
  const files = fileNames.map((name) => ({ name, ...splitName(name) }));
  const projects = files.filter((f) => f.extension === 'dam');
  const maps = new Map<string, DaMapFiles>();
  files
    .filter((f) => f.extension === 'json')
    .forEach((json) => {
      const image = files
        .filter((f) => f.stem === json.stem && IMAGE_PRIORITY.includes(f.extension))
        .sort((a, b) => IMAGE_PRIORITY.indexOf(a.extension) - IMAGE_PRIORITY.indexOf(b.extension))[0];
      if (!image) {
        throw new Error(`"${json.name}" has no picture next to it (expected "${json.stem}.jpg", .png or .webp)`);
      }
      const match = FLOOR_SUFFIX.exec(json.stem);
      const base = match ? json.stem.slice(0, match.index) : json.stem;
      const name = base.replace(EXPORT_SUFFIX, '').trim() || base;
      const project = projects.filter((p) => base.startsWith(p.stem)).sort((a, b) => b.stem.length - a.stem.length)[0];
      const map = maps.get(base) ?? { name, floors: [], project: project?.name ?? null };
      map.floors.push({ index: match ? Number(match[1]) : 0, json: json.name, image: image.name });
      maps.set(base, map);
    });
  return [...maps.values()].map((m) => ({ ...m, floors: m.floors.sort((a, b) => a.index - b.index) }));
}

/** Map name of one floor; multi-floor exports become one map per floor. */
export function daFloorName(map: DaMapFiles, floor: DaFloorFiles): string {
  return map.floors.length > 1 ? `${map.name} – Floor ${floor.index + 1}` : map.name;
}

/**
 * Reads one floor's Foundry scene JSON: walls and lights in scene pixels (shifted by Foundry's
 * padding) become feet, light radii in grid units become feet.
 */
export function parseDaFloor(text: string, fileName: string): DaFloor {
  const scene = parseOrThrow(sceneSchema, parseJsonFile(text, fileName), fileName, 'Dungeon Alchemist floor');
  const { grid } = scene;
  const pad = {
    x: Math.ceil((scene.width * scene.padding) / grid) * grid,
    y: Math.ceil((scene.height * scene.padding) / grid) * grid,
  };
  const toFeet = (x: number, y: number): Vec2 => ({
    x: ((x - pad.x) / grid) * FEET_PER_SQUARE,
    y: ((y - pad.y) / grid) * FEET_PER_SQUARE,
  });
  const walls: SourceWall[] = [];
  const portals: SourcePortal[] = [];
  scene.walls.forEach((w) => {
    const blocksMovement = w.move !== 0;
    const profile = w.sense === 0 && !blocksMovement ? null : { ...SENSE[w.sense], blocksMovement };
    const [a, b] = [toFeet(w.c[0], w.c[1]), toFeet(w.c[2], w.c[3])];
    if (w.door !== 0) {
      const state = DOOR_STATE[w.ds];
      portals.push({ a, b, kind: 'door', state, secret: w.door === 2, profile: profile ?? FULL_WALL });
    } else if (profile) {
      walls.push({ points: [a, b], profile });
    }
  });
  const unitFeet = FEET_PER_SQUARE / scene.gridDistance;
  const lights = scene.lights.map((l, i): MapLight => ({
    id: newId(),
    name: `Light ${i + 1}`,
    position: { ...toFeet(l.x, l.y), elevationFt: LIGHT_HEIGHT_FT },
    // Foundry's dim radius includes the bright one.
    brightFt: l.bright * unitFeet,
    dimFt: Math.max(0, l.dim - l.bright) * unitFeet,
    color: l.tintColor ? parseHexColor(l.tintColor) : '#ffffff',
    enabled: true,
    attachedTo: null,
  }));
  const level = scene.globalLight ? 'bright' : scene.darkness >= 0.5 ? 'darkness' : 'dim';
  return {
    // Subtracting from 0 keeps an unshifted grid at +0 rather than -0.
    calibration: { pxPerSquare: grid, rotationDeg: 0, offsetPx: { x: 0 - scene.shiftX, y: 0 - scene.shiftY } },
    // Dungeon Alchemist renders its lights into the picture.
    content: { ...buildStructures(walls, portals), lights, ...bakedLighting(level) },
    image: { widthPx: scene.width, heightPx: scene.height },
  };
}
