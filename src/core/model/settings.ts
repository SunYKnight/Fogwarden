import { z } from 'zod';

export const SETTINGS_SCHEMA_VERSION = 2;

export const encounterLocatorSchema = z.object({ campaignId: z.string(), encounterId: z.string() });
export type EncounterLocator = z.infer<typeof encounterLocatorSchema>;

export const settingsSchema = z.object({
  schema: z.literal('settings'),
  version: z.number().int().positive(),
  playerWindow: z.object({
    /** Monitor name as reported by the OS; null opens the window on the primary monitor. */
    monitorName: z.string().nullable(),
    fullscreen: z.boolean(),
  }),
  /** 5e default counts every diagonal as 5 ft; the variant alternates 5 and 10 ft. */
  diagonalRule: z.enum(['5-5-5', '5-10-5']),
  lan: z.object({ port: z.number().int().min(1024).max(65535) }),
  /** Encounter the Play screen shows; survives restarts so "Continue" works. */
  lastEncounter: encounterLocatorSchema.nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return {
    schema: 'settings',
    version: SETTINGS_SCHEMA_VERSION,
    playerWindow: { monitorName: null, fullscreen: true },
    diagonalRule: '5-5-5',
    lan: { port: 7717 },
    lastEncounter: null,
  };
}
