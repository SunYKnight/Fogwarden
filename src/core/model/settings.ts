import { z } from 'zod';

export const SETTINGS_SCHEMA_VERSION = 10;

/** View of all player characters together; any other view is one player character's combatant id. */
export const PARTY_VIEW = 'party';

export const encounterLocatorSchema = z.object({ campaignId: z.string(), encounterId: z.string() });
export type EncounterLocator = z.infer<typeof encounterLocatorSchema>;

export const onboardingSchema = z.object({
  /** The Home page hides the first steps card once dismissed or all steps are done. */
  dismissed: z.boolean(),
  done: z.object({
    dataFolder: z.boolean(),
    mapFromImage: z.boolean(),
    sampleEncounter: z.boolean(),
  }),
});
export type Onboarding = z.infer<typeof onboardingSchema>;
export type OnboardingStep = keyof Onboarding['done'];

export function defaultOnboarding(): Onboarding {
  return {
    dismissed: false,
    done: { dataFolder: false, mapFromImage: false, sampleEncounter: false },
  };
}

export const remoteSettingsSchema = z.object({
  /** Relay base URL, e.g. `https://fogwarden.example.org`; empty until set up. */
  url: z.string(),
  /** Secret the install script created; authenticates this app as the DM. */
  dmKey: z.string(),
  /** Inputs of the install script and the SSH deploy; passwords are never stored. */
  setup: z.object({
    domain: z.string(),
    /** Let's Encrypt account email; empty skips certbot. */
    email: z.string(),
    appPort: z.number().int().min(1024).max(65535),
  }),
  ssh: z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    user: z.string(),
    /** Private key file; null means password login. */
    keyPath: z.string().nullable(),
  }),
  /** Trusted SSH host key fingerprints by `host:port`, confirmed on first connect. */
  knownHosts: z.record(z.string(), z.string()),
});
export type RemoteSettings = z.infer<typeof remoteSettingsSchema>;

export function defaultRemoteSettings(): RemoteSettings {
  return {
    url: '',
    dmKey: '',
    setup: { domain: '', email: '', appPort: 7718 },
    ssh: { host: '', port: 22, user: 'root', keyPath: null },
    knownHosts: {},
  };
}

export const playerLinksSchema = z.object({
  /** Key the link tokens are derived from; empty until the app first needs links. */
  secret: z.string(),
  /** How often each view's link was replaced, by view; a view missing here was never replaced. */
  rotations: z.record(z.string(), z.number().int().nonnegative()),
});
export type PlayerLinks = z.infer<typeof playerLinksSchema>;

export function defaultPlayerLinks(): PlayerLinks {
  return { secret: '', rotations: {} };
}

export const packSettingsSchema = z.object({
  /** Pack ids from highest to lowest precedence; installed packs missing here follow, user packs first. */
  order: z.array(z.string()),
  /** Pack ids whose documents are hidden; every other installed pack is enabled. */
  disabled: z.array(z.string()),
});
export type PackSettings = z.infer<typeof packSettingsSchema>;

export function defaultPackSettings(): PackSettings {
  return { order: [], disabled: [] };
}

export const audioSettingsSchema = z.object({
  /** Master volume 0..1 of music, effects and ambience for everyone; players scale it with their own. */
  volume: z.number().min(0).max(1),
  /** Volume 0..1 in the DM window only; 0 when the player window on this computer plays the sound. */
  dmVolume: z.number().min(0).max(1),
});
export type AudioSettings = z.infer<typeof audioSettingsSchema>;

export function defaultAudioSettings(): AudioSettings {
  return { volume: 0.8, dmVolume: 1 };
}

export const updateSettingsSchema = z.object({
  /** Look for a new release on start, at most once a day (Settings > About). */
  autoCheck: z.boolean(),
  /** ISO time of the last automatic check; null before the first. */
  lastCheck: z.string().nullable(),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export function defaultUpdateSettings(): UpdateSettings {
  return { autoCheck: true, lastCheck: null };
}

export const settingsSchema = z.object({
  schema: z.literal('settings'),
  version: z.number().int().positive(),
  playerWindow: z.object({
    /** Monitor name as reported by the OS; null opens the window on the primary monitor. */
    monitorName: z.string().nullable(),
    fullscreen: z.boolean(),
    /** What the player window shows: `PARTY_VIEW` or a player character of the open encounter. */
    view: z.string(),
  }),
  /** 5e default counts every diagonal as 5 ft; the variant alternates 5 and 10 ft. */
  diagonalRule: z.enum(['5-5-5', '5-10-5']),
  lan: z.object({ port: z.number().int().min(1024).max(65535) }),
  /** Encounter the Play screen shows; survives restarts so "Continue" works. */
  lastEncounter: encounterLocatorSchema.nullable(),
  onboarding: onboardingSchema,
  /** Tokens stand upright as picture cards in the 3D view (DM and players); false keeps discs. */
  tokenStandees: z.boolean(),
  /** Internet relay for remote players (Server page). */
  remote: remoteSettingsSchema,
  /** Player links per view for the LAN server and the relay. */
  playerLinks: playerLinksSchema,
  /** Order and enabled state of the content packs (Compendium > Packs). */
  packs: packSettingsSchema,
  /** Sound volumes (Settings > Audio, Play > Sound). */
  audio: audioSettingsSchema,
  /** Release checks of the desktop app (Settings > About). */
  updates: updateSettingsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return {
    schema: 'settings',
    version: SETTINGS_SCHEMA_VERSION,
    playerWindow: { monitorName: null, fullscreen: true, view: PARTY_VIEW },
    diagonalRule: '5-5-5',
    lan: { port: 7717 },
    lastEncounter: null,
    onboarding: defaultOnboarding(),
    tokenStandees: true,
    remote: defaultRemoteSettings(),
    playerLinks: defaultPlayerLinks(),
    packs: defaultPackSettings(),
    audio: defaultAudioSettings(),
    updates: defaultUpdateSettings(),
  };
}
