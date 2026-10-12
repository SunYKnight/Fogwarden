import { z } from 'zod';
import { assetRefSchema, docHeader, docRefSchema, idSchema, mapPointSchema, timestampSchema } from './common';
import { conditionSchema, sensesSchema, sizeSchema } from './creature';
import { areaMarkerSchema } from './marker';

export const ENCOUNTER_SCHEMA_VERSION = 1;
export const CAMPAIGN_SCHEMA_VERSION = 1;

export const sideSchema = z.enum(['player', 'ally', 'enemy', 'neutral']);
export type Side = z.infer<typeof sideSchema>;

export const combatantSchema = z.object({
  id: idSchema,
  /** Library creature this combatant was spawned from; null for ad-hoc entries. */
  creature: docRefSchema.nullable(),
  name: z.string(),
  side: sideSchema,
  size: sizeSchema,
  armorClass: z.number().int(),
  hp: z.object({
    current: z.number().int(),
    max: z.number().int().nonnegative(),
    temp: z.number().int().nonnegative(),
  }),
  initiative: z.number().int().nullable(),
  conditions: z.array(conditionSchema),
  /** Null while the combatant is not placed on the map. */
  position: mapPointSchema.nullable(),
  facingDeg: z.number(),
  /** Copied from the creature so vision works without loading the library. */
  senses: sensesSchema,
  /** Player fog of war is computed from all combatants with this flag. */
  visionSource: z.boolean(),
  hiddenFromPlayers: z.boolean(),
  token: assetRefSchema.nullable(),
  notes: z.string(),
});
export type Combatant = z.infer<typeof combatantSchema>;

export const logEntrySchema = z.object({
  id: idSchema,
  at: timestampSchema,
  kind: z.enum(['roll', 'damage', 'heal', 'note', 'turn']),
  text: z.string(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const fogSchema = z.object({
  /** Fog cells per grid square edge. */
  cellsPerSquare: z.number().int().min(1).max(8),
  /** Base64 bitsets, one bit per fog cell, row-major (south rows, east columns). */
  explored: z.string(),
  revealedByDm: z.string(),
  hiddenByDm: z.string(),
});
export type Fog = z.infer<typeof fogSchema>;

export const encounterSchema = z.object({
  ...docHeader('encounter'),
  campaignId: idSchema,
  map: docRefSchema.nullable(),
  round: z.number().int().nonnegative(),
  turnIndex: z.number().int().nonnegative(),
  combatants: z.array(combatantSchema),
  markers: z.array(areaMarkerSchema),
  /** Door states changed during play, keyed by opening id; the map document stays untouched. */
  openingStates: z.record(idSchema, z.enum(['open', 'closed', 'locked'])),
  fog: fogSchema,
  log: z.array(logEntrySchema),
  notes: z.string(),
});
export type Encounter = z.infer<typeof encounterSchema>;

export const campaignSchema = z.object({
  ...docHeader('campaign'),
  notes: z.string(),
});
export type Campaign = z.infer<typeof campaignSchema>;
