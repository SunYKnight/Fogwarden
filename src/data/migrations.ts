import { z } from 'zod';
import {
  CAMPAIGN_SCHEMA_VERSION,
  CREATURE_SCHEMA_VERSION,
  defaultAtmosphere,
  defaultAudioSettings,
  defaultGraphicsSettings,
  defaultOnboarding,
  defaultPackSettings,
  defaultPlayerLinks,
  defaultRemoteSettings,
  defaultUpdateSettings,
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

// Steps read fields of raw file JSON; parsing them names the broken field
// where a cast would fail later with "Cannot read properties of undefined".
const fields = z.record(z.string(), z.unknown());
const fieldList = z.array(fields);

const CURRENT_VERSION: Record<SchemaName, number> = {
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
      regions: z
        .looseObject({ regions: fieldList })
        .parse(doc)
        .regions.map((region) => ({ ...region, sound: null })),
    }),
  ],
  marker: [],
  campaign: [
    // v2: campaign notes moved into notes.md.
    LAYOUT,
    // v3: the group's player characters; nobody had named them before.
    (doc) => ({ ...doc, party: [] }),
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
      combatants: z
        .looseObject({ combatants: fieldList })
        .parse(doc)
        .combatants.map((c) => ({ ...c, ...freshCombatState(null) })),
    }),
    // v6: players may move their own tokens; off until the DM allows it.
    (doc) => ({ ...doc, playersMoveTokens: false }),
    // v7: distance moved this turn; turns already running count from now.
    (doc) => ({ ...doc, turnStart: null }),
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
      playerWindow: { ...z.looseObject({ playerWindow: fields }).parse(doc).playerWindow, view: PARTY_VIEW },
      playerLinks: defaultPlayerLinks(),
    }),
    // v7: content packs, all enabled; `packMigration.ts` moves the data root's
    // documents into packs while settings.json is older than this version.
    (doc) => ({ ...doc, packs: defaultPackSettings() }),
    // v8: sound volumes.
    (doc) => ({ ...doc, audio: defaultAudioSettings() }),
    // v9: release checks of the desktop app.
    (doc) => ({ ...doc, updates: defaultUpdateSettings() }),
    // v10: the import from the old tool and its first step are gone.
    (doc) => {
      const { onboarding } = z.looseObject({ onboarding: z.looseObject({ done: fields }) }).parse(doc);
      const { done, ...rest } = onboarding;
      const { legacyImport: _unused, ...steps } = done;
      return { ...doc, onboarding: { ...rest, done: steps } };
    },
    // v11: graphics quality; GPU detection needs a browser, so the Settings
    // page only suggests a preset instead of choosing one here.
    (doc) => ({ ...doc, graphics: defaultGraphicsSettings() }),
    // v12: per-kind pack visibility and hidden name duplicates (on).
    (doc) => ({ ...doc, packs: { ...defaultPackSettings(), ...z.looseObject({ packs: fields }).parse(doc).packs } }),
    // v13: texture size, shadow map size, antialiasing and frame rate limit
    // at their former fixed values; the picked preset and sliders stay.
    (doc) => ({
      ...doc,
      graphics: { ...defaultGraphicsSettings(), ...z.looseObject({ graphics: fields }).parse(doc).graphics },
    }),
  ],
};

function exploredPerCharacter(doc: Record<string, unknown>): Record<string, unknown> {
  const { fog: fogField, combatants } = z
    .looseObject({
      fog: z.looseObject({ explored: z.string() }),
      combatants: z.array(z.looseObject({ id: z.string(), side: z.string(), visionSource: z.boolean() })),
    })
    .parse(doc);
  const { explored, ...fog } = fogField;
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
  let doc = fields.parse(raw);
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
