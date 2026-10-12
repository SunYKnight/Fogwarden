import { z } from 'zod';
import { colorSchema, docHeader, idSchema, mapPointSchema } from './common';
import { abilitySchema, damageTypeSchema } from './creature';

export const MARKER_SCHEMA_VERSION = 1;

export const AREA_SHAPES = ['cone', 'cube', 'cylinder', 'line', 'sphere'] as const;
export const areaShapeSchema = z.enum(AREA_SHAPES);
export type AreaShape = z.infer<typeof areaShapeSchema>;

/**
 * 5e area of effect dimensions.
 * `sizeFt`: cone length, cube side, cylinder/sphere radius, line length.
 * `widthFt`: line width. `heightFt`: cylinder height.
 */
export const areaDimensionsSchema = z.object({
  shape: areaShapeSchema,
  sizeFt: z.number().positive(),
  widthFt: z.number().positive(),
  heightFt: z.number().positive(),
});
export type AreaDimensions = z.infer<typeof areaDimensionsSchema>;

/** Saving throw creatures in the area make, e.g. Fireball: DEX 15, 8d6 fire, half on success. */
export const areaSaveSchema = z.object({
  ability: abilitySchema,
  dc: z.number().int().min(1),
  /** Dice rolled once for all targets; empty for saves without damage. */
  damage: z.string(),
  damageType: damageTypeSchema,
  halfOnSuccess: z.boolean(),
});
export type AreaSave = z.infer<typeof areaSaveSchema>;

export const markerTemplateSchema = z.object({
  ...docHeader('marker'),
  ...areaDimensionsSchema.shape,
  color: colorSchema,
  opacity: z.number().min(0).max(1),
  notes: z.string(),
  /** Absent for areas without a saving throw. */
  save: areaSaveSchema.optional(),
});
export type MarkerTemplate = z.infer<typeof markerTemplateSchema>;

export const areaMarkerSchema = z.object({
  id: idSchema,
  templateId: idSchema.nullable(),
  label: z.string(),
  ...areaDimensionsSchema.shape,
  origin: mapPointSchema,
  directionDeg: z.number(),
  color: colorSchema,
  opacity: z.number().min(0).max(1),
  visibleToPlayers: z.boolean(),
  /** Copied from the template; absent for areas without a saving throw. */
  save: areaSaveSchema.optional(),
});
export type AreaMarker = z.infer<typeof areaMarkerSchema>;
