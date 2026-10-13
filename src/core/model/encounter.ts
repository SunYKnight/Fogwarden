import { z } from 'zod';
import {
  assetRefSchema,
  colorSchema,
  docHeader,
  docRefSchema,
  idSchema,
  mapPointSchema,
  timestampSchema,
} from './common';
import { conditionSchema, sensesSchema, sizeSchema } from './creature';
import { areaMarkerSchema } from './marker';

export const ENCOUNTER_SCHEMA_VERSION = 7;
export const CAMPAIGN_SCHEMA_VERSION = 2;

export const sideSchema = z.enum(['player', 'ally', 'enemy', 'neutral']);
export type Side = z.infer<typeof sideSchema>;

/** Turn boundary at which an effect ends: start or end of `turnOf`'s turn in `round`. */
export const effectExpirySchema = z.object({
  round: z.number().int().positive(),
  turnOf: idSchema,
  at: z.enum(['start', 'end']),
});
export type EffectExpiry = z.infer<typeof effectExpirySchema>;

export const effectSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** Condition imposed while the effect lasts; null for effects such as Bless. */
  condition: conditionSchema.nullable(),
  /** Null lasts until removed by hand. */
  expires: effectExpirySchema.nullable(),
});
export type Effect = z.infer<typeof effectSchema>;

/** Spent monster resources; the maxima come from the stat block (`creatureResources`). */
export const combatResourcesSchema = z.object({
  legendaryUsed: z.number().int().nonnegative(),
  /** Names of recharge abilities used and not yet recharged. */
  recharging: z.array(z.string()),
  /** Spell slots used by slot level ("1" to "9"). */
  slotsUsed: z.record(z.string(), z.number().int().nonnegative()),
  /** Uses of per-day features and innate spells by name. */
  dailyUsed: z.record(z.string(), z.number().int().nonnegative()),
});
export type CombatResources = z.infer<typeof combatResourcesSchema>;

/** Torch, lantern or other light following the token. */
export const carriedLightSchema = z.object({
  name: z.string(),
  brightFt: z.number().nonnegative(),
  dimFt: z.number().nonnegative(),
  color: colorSchema,
});
export type CarriedLight = z.infer<typeof carriedLightSchema>;

export const deathSavesSchema = z.object({
  successes: z.number().int().min(0).max(3),
  failures: z.number().int().min(0).max(3),
});
export type DeathSaves = z.infer<typeof deathSavesSchema>;

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
  /** Player character level for encounter difficulty; null when unknown or not a PC. */
  level: z.number().int().min(1).max(20).nullable(),
  effects: z.array(effectSchema),
  concentrating: z.boolean(),
  /** Only meaningful while a player character is at 0 hit points. */
  deathSaves: deathSavesSchema,
  resources: combatResourcesSchema,
  light: carriedLightSchema.nullable(),
});
export type Combatant = z.infer<typeof combatantSchema>;

type CombatState = Pick<Combatant, 'level' | 'effects' | 'concentrating' | 'deathSaves' | 'resources' | 'light'>;

/** Combat rule fields of a combatant that has not taken part in any fight yet. */
export function freshCombatState(level: number | null): CombatState {
  return {
    level,
    effects: [],
    concentrating: false,
    deathSaves: { successes: 0, failures: 0 },
    resources: { legendaryUsed: 0, recharging: [], slotsUsed: {}, dailyUsed: {} },
    light: null,
  };
}

export const logEntrySchema = z.object({
  id: idSchema,
  at: timestampSchema,
  kind: z.enum(['roll', 'damage', 'heal', 'note', 'turn', 'xp', 'loot', 'death']),
  text: z.string(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const fogSchema = z.object({
  /** Fog cells per grid square edge. */
  cellsPerSquare: z.number().int().min(1).max(8),
  /**
   * Base64 bitsets, one bit per fog cell, row-major (south rows, east columns). Explored cells are kept per
   * vision source by combatant id; the party remembers their union. Files keep each set as a black-and-white
   * PNG mask in the encounter's `fog` folder (`encounterFileSchema`).
   */
  exploredBy: z.record(idSchema, z.string()),
  revealedByDm: z.string(),
  hiddenByDm: z.string(),
});
export type Fog = z.infer<typeof fogSchema>;

export const WEATHERS = ['none', 'rain', 'snow', 'fog'] as const;
export const weatherSchema = z.enum(WEATHERS);
export type Weather = z.infer<typeof weatherSchema>;

/** Music, time of day and weather of the scene; the same for every player view. */
export const atmosphereSchema = z.object({
  /** Mood (playlist id) outside combat; null plays no music. */
  mood: idSchema.nullable(),
  /** Mood Start combat switches to and End combat leaves; null keeps the music. */
  combatMood: idSchema.nullable(),
  /** In-game minute of the day driving the ambient light; null keeps the map's own light. */
  minute: z.number().int().min(0).max(1439).nullable(),
  weather: weatherSchema,
});
export type Atmosphere = z.infer<typeof atmosphereSchema>;

export function defaultAtmosphere(): Atmosphere {
  return { mood: null, combatMood: 'combat', minute: null, weather: 'none' };
}

export const encounterSchema = z.object({
  ...docHeader('encounter'),
  campaignId: idSchema,
  map: docRefSchema.nullable(),
  round: z.number().int().nonnegative(),
  turnIndex: z.number().int().nonnegative(),
  /** Where the combatant whose turn it is stood when the turn began; null before combat or while off the map. */
  turnStart: mapPointSchema.nullable(),
  combatants: z.array(combatantSchema),
  markers: z.array(areaMarkerSchema),
  /** Door states changed during play, keyed by opening id; the map document stays untouched. */
  openingStates: z.record(idSchema, z.enum(['open', 'closed', 'locked'])),
  fog: fogSchema,
  log: z.array(logEntrySchema),
  notes: z.string(),
  atmosphere: atmosphereSchema,
  /** Players may drag their own character's token; each move reaches the DM as an undoable step. */
  playersMoveTokens: z.boolean(),
});
export type Encounter = z.infer<typeof encounterSchema>;

export const campaignSchema = z.object({
  ...docHeader('campaign'),
  notes: z.string(),
});
export type Campaign = z.infer<typeof campaignSchema>;

/** `encounter.json` in an encounter folder; the fog bitsets live in its `fog` folder as PNG masks. */
export const encounterFileSchema = encounterSchema.extend({ fog: fogSchema.pick({ cellsPerSquare: true }) });
export type EncounterFile = z.infer<typeof encounterFileSchema>;

/** `campaign.json` in a campaign folder; the notes live next to it in `notes.md`. */
export const campaignFileSchema = campaignSchema.omit({ notes: true });
export type CampaignFile = z.infer<typeof campaignFileSchema>;
