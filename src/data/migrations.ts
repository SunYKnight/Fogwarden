import {
  CAMPAIGN_SCHEMA_VERSION,
  CREATURE_SCHEMA_VERSION,
  defaultAtmosphere,
  defaultAudioSettings,
  defaultOnboarding,
  defaultPackSettings,
  defaultPlayerLinks,
  defaultRemoteSettings,
  ENCOUNTER_SCHEMA_VERSION,
  freshCombatState,
  MAP_SCHEMA_VERSION,
  MARKER_SCHEMA_VERSION,
  PARTY_VIEW,
  SETTINGS_SCHEMA_VERSION,
} from '@/core/model';

export type SchemaName = 'creature' | 'map' | 'marker' | 'campaign' | 'encounter' | 'settings';

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** A step that moved data into other files; `layoutMigration.ts` performs it once per data root. */
const LAYOUT = 'layout';

export const CURRENT_VERSION: Record<SchemaName, number> = {
  creature: CREATURE_SCHEMA_VERSION,
  map: MAP_SCHEMA_VERSION,
  marker: MARKER_SCHEMA_VERSION,
  campaign: CAMPAIGN_SCHEMA_VERSION,
  encounter: ENCOUNTER_SCHEMA_VERSION,
  settings: SETTINGS_SCHEMA_VERSION,
};

/**
 * `MIGRATIONS[schema][n]` upgrades a document from version n+1 to n+2.
 * A schema version bump must append exactly one step here.
 */
const MIGRATIONS: Record<SchemaName, (Migration | typeof LAYOUT)[]> = {
  creature: [
    // v2: creatures are text files (stat block plus header).
    LAYOUT,
  ],
  map: [
    // v2: terrain heights moved from base64 into terrain.png.
    LAYOUT,
    // v3: sound regions carry an ambient loop.
    (doc) => ({
      ...doc,
      regions: (doc.regions as Record<string, unknown>[]).map((region) => ({ ...region, sound: null })),
    }),
  ],
  marker: [],
  campaign: [
    // v2: campaign notes moved into notes.md.
    LAYOUT,
  ],
  encounter: [
    // v2: explored fog per character; nobody knows who saw what before, so
    // every player character and vision source keeps the shared set.
    exploredPerCharacter,
    // v3: encounter folders with fog bitsets as PNG masks.
    LAYOUT,
    // v4: music, time of day and weather of the scene.
    (doc) => ({ ...doc, atmosphere: defaultAtmosphere() }),
    // v5: levels, timed effects, concentration, death saves, monster resources
    // and carried lights; old encounters knew none of them.
    (doc) => ({
      ...doc,
      combatants: (doc.combatants as Record<string, unknown>[]).map((c) => ({ ...c, ...freshCombatState(null) })),
    }),
    // v6: players may move their own tokens; off until the DM allows it.
    (doc) => ({ ...doc, playersMoveTokens: false }),
  ],
  settings: [
    // v2: the never-used lastCampaignId became lastEncounter.
    ({ lastCampaignId: _unused, ...rest }) => ({ ...rest, lastEncounter: null }),
    // v3: first steps progress for the Home page.
    (doc) => ({ ...doc, onboarding: defaultOnboarding() }),
    // v4: tokens may stand upright in the 3D view.
    (doc) => ({ ...doc, tokenStandees: true }),
    // v5: internet relay connection and server setup.
    (doc) => ({ ...doc, remote: defaultRemoteSettings() }),
    // v6: per-view player links and the player window's view.
    (doc) => ({
      ...doc,
      playerWindow: { ...(doc.playerWindow as Record<string, unknown>), view: PARTY_VIEW },
      playerLinks: defaultPlayerLinks(),
    }),
    // v7: content packs, all enabled; `packMigration.ts` moves the data root's
    // documents into packs while settings.json is older than this version.
    (doc) => ({ ...doc, packs: defaultPackSettings() }),
    // v8: sound volumes.
    (doc) => ({ ...doc, audio: defaultAudioSettings() }),
  ],
};

function exploredPerCharacter(doc: Record<string, unknown>): Record<string, unknown> {
  const { explored, ...fog } = doc.fog as { explored: string };
  const combatants = doc.combatants as { id: string; side: string; visionSource: boolean }[];
  const owners = explored === '' ? [] : combatants.filter((c) => c.visionSource || c.side === 'player');
  return { ...doc, fog: { ...fog, exploredBy: Object.fromEntries(owners.map((c) => [c.id, explored])) } };
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Upgrades a document to `target` (default: current) with the pure steps; layout steps throw. */
export function migrate(schema: SchemaName, raw: unknown, target = CURRENT_VERSION[schema]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MigrationError(`Expected a ${schema} document object`);
  }
  let doc = raw as Record<string, unknown>;
  if (doc.schema !== schema) {
    throw new MigrationError(`Expected schema "${schema}", found "${String(doc.schema)}"`);
  }
  const current = CURRENT_VERSION[schema];
  const version = doc.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > current) {
    throw new MigrationError(`Unsupported ${schema} version ${String(version)} (current ${current})`);
  }
  for (let v = version; v < target; v++) {
    const step = MIGRATIONS[schema][v - 1]!;
    if (step === LAYOUT) {
      throw new MigrationError(`${schema} version ${v} uses the old file layout and was not converted`);
    }
    doc = { ...step(doc), version: v + 1 };
  }
  return doc;
}
