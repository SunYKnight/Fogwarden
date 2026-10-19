import { z } from 'zod';

export const SETTINGS_SCHEMA_VERSION = 14;

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
    // Absent in settings written before this step existed.
    srdData: z.boolean().default(false),
  }),
});
export type Onboarding = z.infer<typeof onboardingSchema>;
export type OnboardingStep = keyof Onboarding['done'];

export function defaultOnboarding(): Onboarding {
  return {
    dismissed: false,
    done: { dataFolder: false, mapFromImage: false, sampleEncounter: false, srdData: false },
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

export const dmRemoteSchema = z.object({
  /** The LAN server lets the DM link in: a second device of the DM controls this app. */
  enabled: z.boolean(),
  /** How often the DM link was replaced; its token derives from `playerLinks.secret` like player links. */
  rotation: z.number().int().nonnegative(),
});
export type DmRemote = z.infer<typeof dmRemoteSchema>;

export function defaultDmRemote(): DmRemote {
  return { enabled: false, rotation: 0 };
}

/** Kinds of library documents; My content and every pack keep each kind in its own folder. */
export const libraryKindSchema = z.enum(['creature', 'marker', 'map', 'table', 'item', 'spell']);
export type LibraryKind = z.infer<typeof libraryKindSchema>;

export const packSettingsSchema = z.object({
  /** Pack ids from highest to lowest precedence; installed packs missing here follow, user packs first. */
  order: z.array(z.string()),
  /** Pack ids whose documents are hidden; every other installed pack is enabled. */
  disabled: z.array(z.string()),
  /** Kinds an enabled pack hides, by pack id; for those kinds the pack counts as disabled. */
  hiddenKinds: z.record(z.string(), z.array(libraryKindSchema)),
  /**
   * Lists show one creature, area template, item or spell per name: the one from the pack highest up.
   * References by id still find the others.
   */
  hideDuplicates: z.boolean(),
});
export type PackSettings = z.infer<typeof packSettingsSchema>;

export function defaultPackSettings(): PackSettings {
  return { order: [], disabled: [], hiddenKinds: {}, hideDuplicates: true };
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

/** Longest texture edges the 3D views may upload, in pixels. */
export const TEXTURE_SIZES_PX = [1024, 2048, 4096] as const;
/** Edge lengths of the depth maps of a shadow-casting light, in pixels. */
export const SHADOW_MAP_SIZES_PX = [256, 512, 1024] as const;

export const graphicsSettingsSchema = z.object({
  /** Map lights casting shadows; each one renders six depth maps a frame. */
  shadowedLights: z.number().int().min(0).max(8),
  /** Fraction of the device pixel ratio the 3D views render at. */
  resolutionScale: z.number().min(0.5).max(1),
  /** Props cast shadows; they always receive them. */
  propShadows: z.boolean(),
  /** Longest edge of battlemap, picture and model textures in the 3D views; exports keep full size. */
  textureSizePx: z.literal(TEXTURE_SIZES_PX),
  /** Edge of each shadow depth map of a light. */
  shadowMapSizePx: z.literal(SHADOW_MAP_SIZES_PX),
  /** Smoothed edges (multisampling); changing it recreates the 3D views. */
  antialias: z.boolean(),
  /** Frames per second the 3D views render at most; null renders every display frame. */
  maxFps: z.union([z.literal(15), z.literal(30)]).nullable(),
});
export type GraphicsSettings = z.infer<typeof graphicsSettingsSchema>;

export function defaultGraphicsSettings(): GraphicsSettings {
  return {
    shadowedLights: 4,
    resolutionScale: 1,
    propShadows: true,
    textureSizePx: 4096,
    shadowMapSizePx: 512,
    antialias: true,
    maxFps: null,
  };
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
  /** The DM's second device on the LAN (Players menu > LAN). */
  dmRemote: dmRemoteSchema,
  /** Order and enabled state of the content packs (Settings > Content). */
  packs: packSettingsSchema,
  /** Sound volumes (Settings > Audio, Play > Sound). */
  audio: audioSettingsSchema,
  /** Release checks of the desktop app (Settings > About). */
  updates: updateSettingsSchema,
  /** Render cost of the 3D views on this computer (Settings > Graphics). */
  graphics: graphicsSettingsSchema,
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
    dmRemote: defaultDmRemote(),
    packs: defaultPackSettings(),
    audio: defaultAudioSettings(),
    updates: defaultUpdateSettings(),
    graphics: defaultGraphicsSettings(),
  };
}
