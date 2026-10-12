import { z } from 'zod';
import { colorSchema, docHeader, idSchema, mapPointSchema } from './common';

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

export const markerTemplateSchema = z.object({
  ...docHeader('marker'),
  ...areaDimensionsSchema.shape,
  color: colorSchema,
  opacity: z.number().min(0).max(1),
  notes: z.string(),
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
});
export type AreaMarker = z.infer<typeof areaMarkerSchema>;
