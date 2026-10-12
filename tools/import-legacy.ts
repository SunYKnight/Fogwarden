import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { z } from 'zod';
import {
  convertLegacyCreature,
  convertLegacyMap,
  convertLegacyMarker,
  legacyCreatureSchema,
  legacyId,
  legacyMapSchema,
  legacyMarkerSchema,
} from '../src/core/import/legacy';
import type { AssetRef, CreatureKind } from '../src/core/model';
import { errorMessage, openRepository } from './cli';
import { imageSize } from './imageSize';

/** Usage: pnpm tsx tools/import-legacy.ts <legacy data folder> [--data-root <path>] */
const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'data-root': { type: 'string' } } });
if (!positionals[0]) {
  throw new Error('Usage: import-legacy <path to 240722_DnD_DMTool_Data> [--data-root <path>]');
}
const legacyRoot = resolve(positionals[0]);
// Legacy image paths are relative to the exe folder above the data folder.
const appFolder = dirname(legacyRoot);
const { repository, dataRoot } = openRepository(values['data-root']);

const report = { converted: [] as string[], skipped: [] as string[], warnings: [] as string[] };

function jsonFiles(folder: string): string[] {
  const dir = join(legacyRoot, folder);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => n.toLowerCase().endsWith('.json'))
        .sort()
    : [];
}

function readLegacy<T>(schema: z.ZodType<T>, folder: string, file: string): T {
  return schema.parse(JSON.parse(readFileSync(join(legacyRoot, folder, file), 'utf8').replace(/^\uFEFF/, '')));
}

/** First existing file among the legacy path and the folders the legacy app kept such images in. */
function findImage(legacyPath: string, fallbackDirs: string[]): string | null {
  const name = basename(legacyPath.replace(/\\/g, '/'));
  const candidates = [
    join(appFolder, legacyPath.replace(/\\/g, '/')),
    ...fallbackDirs.map((d) => join(legacyRoot, d, name)),
  ];
  return legacyPath === '' ? null : (candidates.find((c) => existsSync(c)) ?? null);
}

const CREATURE_FOLDERS: [string, CreatureKind][] = [
  ['BeeingType', 'monster'],
  ['NPCs', 'npc'],
  ['Players', 'player'],
];
const creatureIds = new Map<string, string>();
for (const [folder, kind] of CREATURE_FOLDERS) {
  let count = 0;
  for (const file of jsonFiles(folder)) {
    try {
      const legacy = readLegacy(legacyCreatureSchema, folder, file);
      const { doc, warnings } = convertLegacyCreature(legacy, kind);
      const clash = creatureIds.get(doc.id);
      if (clash) {
        throw new Error(`same id "${doc.id}" as ${clash}`);
      }
      const imagePath = findImage(legacy.ImagePath ?? '', [folder, 'MonsterRawData/images', 'MonsterRawData/HotD']);
      let image: AssetRef | null = null;
      if (imagePath) {
        image = { area: 'data', path: `library/creatures/assets/${doc.id}${extname(imagePath).toLowerCase()}` };
        await repository.storage.writeBytes(image.path, readFileSync(imagePath));
      } else if (legacy.ImagePath) {
        warnings.push(`image not found: ${legacy.ImagePath}`);
      }
      await repository.save('creature', { ...doc, image });
      creatureIds.set(doc.id, `${folder}/${file}`);
      report.warnings.push(...warnings.map((w) => `${folder}/${file}: ${w}`));
      count += 1;
    } catch (error) {
      report.skipped.push(`${folder}/${file}: ${errorMessage(error)}`);
    }
  }
  report.converted.push(`${count} creatures from ${folder}`);
}

const mapImages = new Set<string>();
let mapCount = 0;
for (const file of jsonFiles('MapType')) {
  try {
    const legacy = readLegacy(legacyMapSchema, 'MapType', file);
    const imagePath = findImage(legacy.MapPath, ['MapType', 'Maps']);
    let image = null;
    if (imagePath) {
      const bytes = readFileSync(imagePath);
      const asset = await repository.importMapAsset(legacyId(legacy.Name), basename(imagePath), bytes);
      image = { asset, ...imageSize(bytes) };
      mapImages.add(resolve(imagePath));
    } else {
      report.warnings.push(`MapType/${file}: image not found: ${legacy.MapPath}`);
    }
    const { doc, warnings } = convertLegacyMap(legacy, image);
    await repository.save('map', doc);
    report.warnings.push(...warnings.map((w) => `MapType/${file}: ${w}`));
    mapCount += 1;
  } catch (error) {
    report.skipped.push(`MapType/${file}: ${errorMessage(error)}`);
  }
}
report.converted.push(`${mapCount} maps from MapType`);
const mapTypeDir = join(legacyRoot, 'MapType');
const looseImages = existsSync(mapTypeDir)
  ? readdirSync(mapTypeDir).filter((n) => /\.(jpe?g|png)$/i.test(n) && !mapImages.has(resolve(mapTypeDir, n)))
  : [];
report.skipped.push(...looseImages.map((n) => `MapType/${n}: image without a legacy map JSON (create a map from it)`));

let markerCount = 0;
for (const file of jsonFiles('MarkerType')) {
  try {
    const converted = convertLegacyMarker(readLegacy(legacyMarkerSchema, 'MarkerType', file));
    if (typeof converted === 'string') {
      report.skipped.push(`MarkerType/${file}: ${converted}`);
    } else {
      await repository.save('marker', converted);
      markerCount += 1;
    }
  } catch (error) {
    report.skipped.push(`MarkerType/${file}: ${errorMessage(error)}`);
  }
}
report.converted.push(`${markerCount} marker templates from MarkerType`);
const items = jsonFiles('ItemType');
report.skipped.push(...items.map((n) => `ItemType/${n}: items are not part of the new data model`));
if (existsSync(join(legacyRoot, 'MonsterRawData'))) {
  report.skipped.push('MonsterRawData: raw stat blocks; import them with tools/import-statblocks.ts');
}

console.log(`Data root: ${dataRoot}`);
console.log(`Converted:\n  ${report.converted.join('\n  ')}`);
console.log(`Warnings (${report.warnings.length}):\n  ${report.warnings.join('\n  ')}`);
console.log(`Skipped (${report.skipped.length}):\n  ${report.skipped.join('\n  ')}`);
