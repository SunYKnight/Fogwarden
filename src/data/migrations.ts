import {
  CAMPAIGN_SCHEMA_VERSION,
  CREATURE_SCHEMA_VERSION,
  defaultOnboarding,
  ENCOUNTER_SCHEMA_VERSION,
  MAP_SCHEMA_VERSION,
  MARKER_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
} from '@/core/model';

export type SchemaName = 'creature' | 'map' | 'marker' | 'campaign' | 'encounter' | 'settings';

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

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
const MIGRATIONS: Record<SchemaName, Migration[]> = {
  creature: [],
  map: [],
  marker: [],
  campaign: [],
  encounter: [],
  settings: [
    // v2: the never-used lastCampaignId became lastEncounter.
    ({ lastCampaignId: _unused, ...rest }) => ({ ...rest, lastEncounter: null }),
    // v3: first steps progress for the Home page.
    (doc) => ({ ...doc, onboarding: defaultOnboarding() }),
  ],
};

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function migrate(schema: SchemaName, raw: unknown): Record<string, unknown> {
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
  for (let v = version; v < current; v++) {
    doc = { ...MIGRATIONS[schema][v - 1]!(doc), version: v + 1 };
  }
  return doc;
}
