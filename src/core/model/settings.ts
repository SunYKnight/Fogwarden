import { z } from 'zod';

export const SETTINGS_SCHEMA_VERSION = 3;

export const encounterLocatorSchema = z.object({ campaignId: z.string(), encounterId: z.string() });
export type EncounterLocator = z.infer<typeof encounterLocatorSchema>;

export const onboardingSchema = z.object({
  /** The Home page hides the first steps card once dismissed or all steps are done. */
  dismissed: z.boolean(),
  done: z.object({
    dataFolder: z.boolean(),
    legacyImport: z.boolean(),
    mapFromImage: z.boolean(),
    sampleEncounter: z.boolean(),
  }),
});
export type Onboarding = z.infer<typeof onboardingSchema>;
export type OnboardingStep = keyof Onboarding['done'];

export function defaultOnboarding(): Onboarding {
  return {
    dismissed: false,
    done: { dataFolder: false, legacyImport: false, mapFromImage: false, sampleEncounter: false },
  };
}

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
  onboarding: onboardingSchema,
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
    onboarding: defaultOnboarding(),
  };
}
