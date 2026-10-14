import { z } from 'zod';
import { ulid } from 'ulid';

/**
 * Coordinate conventions shared by every document:
 * - All lengths are feet. One grid square is `grid.feetPerSquare` feet (5 by default).
 * - Map plane points (`Vec2`) use x = east, y = south, origin at the map's north-west corner.
 * - Three.js world space is X = east, Y = up, Z = south, so a `Vec2 {x, y}` maps to world `(x, h, y)`.
 */

export const idSchema = z.string().min(1);

export function newId(): string {
  return ulid();
}

export const vec2Schema = z.object({ x: z.number(), y: z.number() });
export type Vec2 = z.infer<typeof vec2Schema>;

/** Position on the map plane plus height above the map's zero level. */
export const mapPointSchema = z.object({ x: z.number(), y: z.number(), elevationFt: z.number() });
export type MapPoint = z.infer<typeof mapPointSchema>;

/** Three.js world-space triple in feet. */
export const worldVec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type WorldVec3 = z.infer<typeof worldVec3Schema>;

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const storageAreaSchema = z.enum(['data', 'content']);
export type StorageArea = z.infer<typeof storageAreaSchema>;

/** File reference relative to the data root or the shipped content root. */
export const assetRefSchema = z.object({ area: storageAreaSchema, path: z.string().min(1) });
export type AssetRef = z.infer<typeof assetRefSchema>;

/** Reference to a library document that may live in shipped content or in user data. */
export const docRefSchema = z.object({ area: storageAreaSchema, id: idSchema });
export type DocRef = z.infer<typeof docRefSchema>;

export const timestampSchema = z.iso.datetime();

export function nowIso(): string {
  return new Date().toISOString();
}

export function docHeader<const S extends string>(schema: S) {
  return {
    schema: z.literal(schema),
    version: z.number().int().positive(),
    id: idSchema,
    name: z.string(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  };
}

export const lightLevelSchema = z.enum(['bright', 'dim', 'darkness', 'magical-darkness']);
export type LightLevel = z.infer<typeof lightLevelSchema>;
