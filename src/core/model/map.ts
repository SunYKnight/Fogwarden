import { z } from 'zod';
import {
  assetRefSchema,
  colorSchema,
  docHeader,
  idSchema,
  lightLevelSchema,
  mapPointSchema,
  vec2Schema,
  worldVec3Schema,
} from './common';

export const MAP_SCHEMA_VERSION = 3;

export const SIDE_MATERIALS = ['projected', 'stone', 'brick', 'wood', 'plaster', 'hedge', 'rock', 'metal'] as const;
export const sideMaterialSchema = z.enum(SIDE_MATERIALS);
export type SideMaterial = z.infer<typeof sideMaterialSchema>;

export const mapImageSchema = z.object({
  asset: assetRefSchema,
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
});
export type MapImage = z.infer<typeof mapImageSchema>;

/** Places the image on the map plane: px = offsetPx + rotate(ft / feetPerSquare * pxPerSquare). */
export const gridSchema = z.object({
  feetPerSquare: z.number().positive(),
  pxPerSquare: z.number().positive(),
  offsetPx: vec2Schema,
  rotationDeg: z.number(),
  squaresX: z.number().int().positive(),
  squaresY: z.number().int().positive(),
  show: z.boolean(),
  color: colorSchema,
  opacity: z.number().min(0).max(1),
});
export type Grid = z.infer<typeof gridSchema>;

export const terrainSchema = z.object({
  /** Height samples per grid square edge; the field has (squaresX*n+1) x (squaresY*n+1) samples. */
  samplesPerSquare: z.number().int().min(1).max(8),
  /**
   * Base64 little-endian Float32 heights in feet, row-major: row = south index, column = east index.
   * In memory and over the sync channel only; files keep them in `terrain.png` (`terrainFileSchema`).
   */
  heights: z.string(),
  /** Ground color where no battlemap image covers the terrain. */
  baseColor: colorSchema,
  cliffMaterial: sideMaterialSchema,
  /** Faces steeper than this angle switch from the projected image to the cliff material. */
  cliffSlopeDeg: z.number().min(10).max(89),
});
export type Terrain = z.infer<typeof terrainSchema>;

export const wallSchema = z.object({
  id: idSchema,
  points: z.array(vec2Schema).min(2),
  closed: z.boolean(),
  heightFt: z.number().positive(),
  thicknessFt: z.number().positive(),
  /** Absolute foot elevation of the wall base; null follows the terrain under each vertex. */
  baseFt: z.number().nullable(),
  material: sideMaterialSchema,
  blocksSight: z.boolean(),
  blocksMovement: z.boolean(),
  blocksLight: z.boolean(),
});
export type Wall = z.infer<typeof wallSchema>;

export const OPENING_KINDS = ['door', 'window', 'portcullis', 'arrow-slit'] as const;
export const openingKindSchema = z.enum(OPENING_KINDS);
export type OpeningKind = z.infer<typeof openingKindSchema>;

export const openingStateSchema = z.enum(['open', 'closed', 'locked']);
export type OpeningState = z.infer<typeof openingStateSchema>;

export const openingSchema = z.object({
  id: idSchema,
  wallId: idSchema,
  /** Index of the wall segment (points[i] -> points[i+1], closing segment last for closed walls). */
  segment: z.number().int().nonnegative(),
  /** Opening center along the segment, 0 = start, 1 = end. */
  t: z.number().min(0).max(1),
  widthFt: z.number().positive(),
  heightFt: z.number().positive(),
  sillFt: z.number().nonnegative(),
  kind: openingKindSchema,
  state: openingStateSchema,
  secret: z.boolean(),
});
export type Opening = z.infer<typeof openingSchema>;

export const roomSchema = z.object({
  id: idSchema,
  name: z.string(),
  polygon: z.array(vec2Schema).min(3),
  /** Absolute floor elevation; null keeps the terrain. */
  floorFt: z.number().nullable(),
  ceilingFt: z.number().positive(),
  roof: z.boolean(),
  roofMaterial: sideMaterialSchema,
});
export type Room = z.infer<typeof roomSchema>;

export const REGION_KINDS = ['light', 'difficult', 'water', 'hazard', 'note', 'sound'] as const;
export const regionKindSchema = z.enum(REGION_KINDS);
export type RegionKind = z.infer<typeof regionKindSchema>;

/** Ambient loop of a `sound` region: full volume inside, silent `radiusFt` beyond the edge. */
export const regionSoundSchema = z.object({
  /** Audio file in the map's assets folder; null until the DM picks one. */
  asset: assetRefSchema.nullable(),
  radiusFt: z.number().nonnegative(),
  /** 0..1 of the DM's master volume. */
  volume: z.number().min(0).max(1),
});
export type RegionSound = z.infer<typeof regionSoundSchema>;

export const regionSchema = z.object({
  id: idSchema,
  name: z.string(),
  polygon: z.array(vec2Schema).min(3),
  kind: regionKindSchema,
  /** Only used by `light` regions. */
  light: lightLevelSchema.nullable(),
  color: colorSchema,
  hiddenFromPlayers: z.boolean(),
  notes: z.string(),
  /** Only used by `sound` regions. */
  sound: regionSoundSchema.nullable(),
});
export type Region = z.infer<typeof regionSchema>;

export const lightSchema = z.object({
  id: idSchema,
  name: z.string(),
  position: mapPointSchema,
  brightFt: z.number().nonnegative(),
  dimFt: z.number().nonnegative(),
  color: colorSchema,
  enabled: z.boolean(),
  /** Combatant id the light follows (torch carried by a token); null for fixed lights. */
  attachedTo: idSchema.nullable(),
});
export type MapLight = z.infer<typeof lightSchema>;

export const propSchema = z.object({
  id: idSchema,
  name: z.string(),
  asset: assetRefSchema,
  /** Three.js world transform in feet / degrees. */
  position: worldVec3Schema,
  rotationDeg: worldVec3Schema,
  scale: worldVec3Schema,
  projectMap: z.boolean(),
  occludesSight: z.boolean(),
  blocksMovement: z.boolean(),
  walkable: z.boolean(),
});
export type Prop = z.infer<typeof propSchema>;

export const mapSchema = z.object({
  ...docHeader('map'),
  tags: z.array(z.string()),
  notes: z.string(),
  image: mapImageSchema.nullable(),
  grid: gridSchema,
  terrain: terrainSchema,
  ambientLight: lightLevelSchema,
  walls: z.array(wallSchema),
  openings: z.array(openingSchema),
  rooms: z.array(roomSchema),
  regions: z.array(regionSchema),
  lights: z.array(lightSchema),
  props: z.array(propSchema),
});
export type BattleMap = z.infer<typeof mapSchema>;

/** Maps `terrain.png` (16-bit grayscale) pixel values to feet: height = baseFt + value * feetPerUnit. */
export const heightmapSchema = z.object({
  file: z.literal('terrain.png'),
  baseFt: z.number(),
  feetPerUnit: z.number().positive(),
});
export type HeightmapRef = z.infer<typeof heightmapSchema>;

export const terrainFileSchema = terrainSchema.omit({ heights: true }).extend({ heightmap: heightmapSchema });

/** `map.json` in a map folder: the map with its heights in the folder's heightmap picture. */
export const mapFileSchema = mapSchema.extend({ terrain: terrainFileSchema });
export type MapFile = z.infer<typeof mapFileSchema>;
