import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRD_LICENSE, SRD_SOURCE } from '../src/core/import/dnd5eApi';
import {
  MARKER_SCHEMA_VERSION,
  markerTemplateSchema,
  type AreaSave,
  type AreaShape,
  type MarkerTemplate,
} from '../src/core/model';
import { formatPackManifest, PACKS_DIR } from '../src/data/packs';
import { CONTENT_ROOT } from './cli';

/**
 * Builds the shipped pack "SRD 5.1" (`content/packs/srd`: `pack.json`, `markers/*.json`): area templates of
 * five SRD 5.1 spells (CC-BY-4.0). Monsters are not shipped; the D&D 5e API import brings them.
 * Usage: pnpm tsx tools/build-srd.ts
 */
// Fixed timestamps (SRD 5.1 CC release) keep regenerated files identical.
const TIMESTAMP = '2023-01-27T00:00:00.000Z';

/** Writes `files` (name to text) and removes generated files of earlier runs that are no longer produced. */
function writeFiles(dir: string, files: [string, string][]): void {
  mkdirSync(dir, { recursive: true });
  const fresh = new Set(files.map(([name]) => name));
  for (const stale of readdirSync(dir).filter((n) => n.startsWith('srd-') && !fresh.has(n))) {
    rmSync(join(dir, stale));
  }
  for (const [name, text] of files) {
    writeFileSync(join(dir, name), text);
  }
}

// Spell save DC 13 is a typical caster's (8 + proficiency 2 + ability 3);
// the DM sets the real one in Play.
const MARKERS: {
  name: string;
  shape: AreaShape;
  sizeFt: number;
  widthFt: number;
  heightFt: number;
  color: string;
  save: AreaSave;
}[] = [
  {
    name: 'Fireball',
    shape: 'sphere',
    sizeFt: 20,
    widthFt: 5,
    heightFt: 40,
    color: '#ff5a1f',
    save: { ability: 'dex', dc: 13, damage: '8d6', damageType: 'fire', halfOnSuccess: true },
  },
  {
    name: 'Burning Hands',
    shape: 'cone',
    sizeFt: 15,
    widthFt: 5,
    heightFt: 15,
    color: '#ff9b2f',
    save: { ability: 'dex', dc: 13, damage: '3d6', damageType: 'fire', halfOnSuccess: true },
  },
  {
    name: 'Lightning Bolt',
    shape: 'line',
    sizeFt: 100,
    widthFt: 5,
    heightFt: 5,
    color: '#7fc8ff',
    save: { ability: 'dex', dc: 13, damage: '8d6', damageType: 'lightning', halfOnSuccess: true },
  },
  {
    name: 'Thunderwave',
    shape: 'cube',
    sizeFt: 15,
    widthFt: 5,
    heightFt: 15,
    color: '#8a7dff',
    save: { ability: 'con', dc: 13, damage: '2d8', damageType: 'thunder', halfOnSuccess: true },
  },
  {
    name: 'Moonbeam',
    shape: 'cylinder',
    sizeFt: 5,
    widthFt: 5,
    heightFt: 40,
    color: '#e6ecff',
    save: { ability: 'con', dc: 13, damage: '2d10', damageType: 'radiant', halfOnSuccess: true },
  },
];

const markers: MarkerTemplate[] = MARKERS.map((m) =>
  markerTemplateSchema.parse({
    schema: 'marker',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    version: MARKER_SCHEMA_VERSION,
    id: `srd-${m.name.toLowerCase().replace(/\s+/g, '-')}`,
    ...m,
    opacity: 0.35,
    notes: `${m.name} (${SRD_SOURCE}, ${SRD_LICENSE})`,
  }),
);
const packDir = join(CONTENT_ROOT, PACKS_DIR, 'srd');
writeFiles(
  join(packDir, 'markers'),
  markers.map((m) => [`${m.id}.json`, `${JSON.stringify(m, null, 2)}\n`]),
);
writeFileSync(
  join(packDir, 'pack.json'),
  formatPackManifest({
    id: 'srd',
    name: SRD_SOURCE,
    version: '5.1',
    author: 'Wizards of the Coast',
    license: SRD_LICENSE,
    description: 'Area templates of the System Reference Document 5.1.',
    url: 'https://dnd.wizards.com/resources/systems-reference-document',
  }),
);
console.log(`Wrote ${markers.length} marker templates to ${packDir}`);
