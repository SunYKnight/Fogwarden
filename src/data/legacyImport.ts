import type { z } from 'zod';
import { imageSize } from '@/core/imageSize';
import { parseJsonFile, parseOrThrow } from '@/core/import/importedMap';
import {
  convertLegacyCreature,
  convertLegacyMap,
  convertLegacyMarker,
  legacyCreatureSchema,
  legacyId,
  legacyMapSchema,
  legacyMarkerSchema,
  type LegacyMap,
} from '@/core/import/legacy';
import type { Creature, CreatureKind, MarkerTemplate } from '@/core/model';
import type { PackManifest } from './packs';
import type { Repository } from './repository';
import type { DirEntry } from './storage';

/**
 * Read access to the folders around a legacy data folder (`240722_DnD_DMTool_Data`): Node fs for the CLI, the
 * desktop app's picked-folder commands in the app. Paths are absolute, '/' or '\' separated.
 */
export interface LegacySource {
  /** Entries of an existing folder. */
  list(folder: string): Promise<DirEntry[]>;
  readText(file: string): Promise<string>;
  readBytes(file: string): Promise<Uint8Array>;
}

/** A file of the legacy folder, relative to it, and what went wrong with it. */
export interface LegacyProblem {
  file: string;
  message: string;
}

export interface LegacyPlan {
  folder: string;
  creatures: { file: string; doc: Creature; image: string | null }[];
  maps: { file: string; legacy: LegacyMap; image: string | null }[];
  markers: { file: string; doc: MarkerTemplate }[];
  /** Pictures found for the creatures and maps. */
  images: number;
  /** Files that will not be imported. */
  skipped: LegacyProblem[];
  /** Files imported with losses, such as a missing picture. */
  warnings: LegacyProblem[];
}

export interface LegacyReport {
  imported: { creatures: number; maps: number; areaTemplates: number };
  skipped: LegacyProblem[];
  warnings: LegacyProblem[];
}

/** The picked folder is not a legacy data folder; the message says what is missing. */
export class LegacyFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyFolderError';
  }
}

export const LEGACY_FOLDER_NAME = '240722_DnD_DMTool_Data';
/** Pack every legacy import goes into; legacy ids start with `legacy--`. */
export const LEGACY_PACK: PackManifest = {
  id: 'legacy-dm-tool',
  name: 'Legacy DM Tool',
  version: '',
  author: '',
  license: '',
  description: 'Creatures, maps and area templates imported from the old WPF DM tool.',
  url: '',
};

const CREATURE_FOLDERS: [string, CreatureKind][] = [
  ['BeeingType', 'monster'],
  ['NPCs', 'npc'],
  ['Players', 'player'],
];
/** Where the legacy tool kept creature pictures besides the creature's own folder. */
const CREATURE_IMAGE_FOLDERS = ['Monsters', 'MonsterRawData/images', 'MonsterRawData/HotD'];
const DATA_FOLDERS = [...CREATURE_FOLDERS.map(([folder]) => folder), 'MapType', 'MarkerType'];
const JSON_FILE = /\.json$/i;
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

function joinPath(folder: string, name: string): string {
  return `${folder.replace(/[\\/]+$/, '')}/${name}`;
}

/** Keeps the trailing separator so the parent of `C:\Data` is the drive root `C:\`. */
function parentOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(0, Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
}

function fileNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** Same file for Windows, where the legacy tool ran: separators and case do not matter. */
function pathKey(path: string): string {
  return path.replace(/[\\/]+/g, '/').toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cached folder listings with Windows-like name lookup, since legacy paths were typed or lowercased. */
class FolderIndex {
  private readonly listings = new Map<string, Promise<DirEntry[]>>();

  constructor(private readonly source: LegacySource) {}

  list(folder: string): Promise<DirEntry[]> {
    const key = pathKey(folder);
    const listing = this.listings.get(key) ?? this.source.list(folder);
    this.listings.set(key, listing);
    return listing;
  }

  /** Actual path of `relative` (may contain `..`) below the existing `folder`, or null when it does not exist. */
  async find(folder: string, relative: string, isDir: boolean): Promise<string | null> {
    const segments = relative.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
    let current: string | null = folder;
    for (const [index, segment] of segments.entries()) {
      const wantDir = isDir || index < segments.length - 1;
      if (current !== null && segment === '..') {
        current = parentOf(current);
      } else if (current !== null) {
        const entry: DirEntry | undefined = (await this.list(current)).find(
          (e) => e.isDir === wantDir && e.name.toLowerCase() === segment.toLowerCase(),
        );
        current = entry ? joinPath(current, entry.name) : null;
      }
    }
    return current;
  }

  /** Matching files of a subfolder, sorted, as `subfolder/name` and absolute path; none if it is missing. */
  async files(folder: string, subfolder: string, pattern: RegExp): Promise<{ file: string; path: string }[]> {
    const dir = await this.find(folder, subfolder, true);
    const entries = dir === null ? [] : await this.list(dir);
    return entries
      .filter((e) => !e.isDir && pattern.test(e.name))
      .map((e) => e.name)
      .sort()
      .map((name) => ({ file: `${subfolder}/${name}`, path: joinPath(dir!, name) }));
  }
}

async function readLegacy<T>(source: LegacySource, path: string, file: string, schema: z.ZodType<T>, what: string) {
  const text = (await source.readText(path)).replace(/^\uFEFF/, '');
  return parseOrThrow(schema, parseJsonFile(text, file), file, what);
}

/** Checks that `folder` holds the legacy tool's data and names what is missing otherwise. */
async function checkFolder(index: FolderIndex, folder: string): Promise<void> {
  const names = new Set((await index.list(folder)).filter((e) => e.isDir).map((e) => e.name.toLowerCase()));
  if (!DATA_FOLDERS.some((f) => names.has(f.toLowerCase()))) {
    const hint = names.has(LEGACY_FOLDER_NAME.toLowerCase())
      ? ` It contains ${LEGACY_FOLDER_NAME}: choose that folder.`
      : ` Choose the ${LEGACY_FOLDER_NAME} folder next to the old tool's program.`;
    throw new LegacyFolderError(`${folder} has none of the old tool's folders (${DATA_FOLDERS.join(', ')}).${hint}`);
  }
}

/**
 * Reads and converts everything in the legacy data folder without writing, so the user sees what an import
 * brings in. Legacy picture paths are relative to the program folder above the data folder; pictures moved
 * since are looked up by file name in the folders the legacy tool kept them in.
 */
export async function planLegacyImport(source: LegacySource, folder: string): Promise<LegacyPlan> {
  const index = new FolderIndex(source);
  await checkFolder(index, folder);
  const programFolder = parentOf(folder);
  const plan: LegacyPlan = { folder, creatures: [], maps: [], markers: [], images: 0, skipped: [], warnings: [] };
  const findImage = async (legacyPath: string, fallbackDirs: string[]): Promise<string | null> => {
    let found = legacyPath === '' ? null : await index.find(programFolder, legacyPath, false);
    for (const dir of legacyPath === '' ? [] : fallbackDirs) {
      found ??= await index.find(folder, `${dir}/${fileNameOf(legacyPath)}`, false);
    }
    return found;
  };

  const creatureFiles = new Map<string, string>();
  for (const [dir, kind] of CREATURE_FOLDERS) {
    for (const { file, path } of await index.files(folder, dir, JSON_FILE)) {
      try {
        const legacy = await readLegacy(source, path, file, legacyCreatureSchema, 'legacy creature');
        const { doc, warnings } = convertLegacyCreature(legacy, kind);
        const clash = creatureFiles.get(doc.id);
        if (clash) {
          throw new Error(`same id "${doc.id}" as ${clash}`);
        }
        const image = await findImage(legacy.ImagePath ?? '', [dir, ...CREATURE_IMAGE_FOLDERS]);
        if (image === null && legacy.ImagePath) {
          warnings.push(`image not found: ${legacy.ImagePath}`);
        }
        creatureFiles.set(doc.id, file);
        plan.creatures.push({ file, doc, image });
        plan.warnings.push(...warnings.map((w) => ({ file, message: w })));
      } catch (error) {
        plan.skipped.push({ file, message: errorMessage(error) });
      }
    }
  }

  const mapImages = new Set<string>();
  for (const { file, path } of await index.files(folder, 'MapType', JSON_FILE)) {
    try {
      const legacy = await readLegacy(source, path, file, legacyMapSchema, 'legacy map');
      const image = await findImage(legacy.MapPath, ['MapType', 'Maps']);
      if (image === null) {
        plan.warnings.push({ file, message: `image not found: ${legacy.MapPath}` });
      } else {
        mapImages.add(pathKey(image));
      }
      plan.maps.push({ file, legacy, image });
    } catch (error) {
      plan.skipped.push({ file, message: errorMessage(error) });
    }
  }
  for (const { file, path } of await index.files(folder, 'MapType', IMAGE_FILE)) {
    if (!mapImages.has(pathKey(path))) {
      plan.skipped.push({ file, message: 'image without a legacy map file; create a map from it with "New map"' });
    }
  }

  for (const { file, path } of await index.files(folder, 'MarkerType', JSON_FILE)) {
    try {
      const converted = convertLegacyMarker(
        await readLegacy(source, path, file, legacyMarkerSchema, 'legacy area template'),
      );
      if (typeof converted === 'string') {
        plan.skipped.push({ file, message: converted });
      } else {
        plan.markers.push({ file, doc: converted });
      }
    } catch (error) {
      plan.skipped.push({ file, message: errorMessage(error) });
    }
  }

  for (const { file } of await index.files(folder, 'ItemType', JSON_FILE)) {
    plan.skipped.push({ file, message: 'items are not part of the new data model' });
  }
  if ((await index.find(folder, 'MonsterRawData', true)) !== null) {
    plan.skipped.push({
      file: 'MonsterRawData',
      message: 'raw stat blocks are not part of this import; drop a .txt file on the Home page to import it',
    });
  }
  plan.images = [...plan.creatures, ...plan.maps].filter((p) => p.image !== null).length;
  return plan;
}

/**
 * Writes a plan into the pack `LEGACY_PACK` in the current data layout. Ids derive from the legacy names, so
 * running it again overwrites the earlier import. A file that fails is reported and the others are still
 * imported.
 */
export async function runLegacyImport(
  plan: LegacyPlan,
  source: LegacySource,
  repository: Repository,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<LegacyReport> {
  const report: LegacyReport = {
    imported: { creatures: 0, maps: 0, areaTemplates: 0 },
    skipped: [...plan.skipped],
    warnings: [...plan.warnings],
  };
  const total = plan.creatures.length + plan.maps.length + plan.markers.length;
  const pack = LEGACY_PACK.id;
  await repository.ensurePack(LEGACY_PACK);
  let done = 0;
  const step = async (file: string, write: () => Promise<void>): Promise<void> => {
    try {
      await write();
    } catch (error) {
      report.skipped.push({ file, message: errorMessage(error) });
    }
    done += 1;
    onProgress(done, total);
  };

  for (const { file, doc, image } of plan.creatures) {
    await step(file, async () => {
      const picture =
        image === null
          ? null
          : await repository.importCreaturePicture(
              doc.id,
              'image',
              fileNameOf(image),
              await source.readBytes(image),
              pack,
            );
      await repository.save('creature', { ...doc, image: picture }, pack);
      report.imported.creatures += 1;
    });
  }
  for (const { file, legacy, image } of plan.maps) {
    await step(file, async () => {
      const picture = image === null ? null : { name: fileNameOf(image), bytes: await source.readBytes(image) };
      // Size first: an unsupported picture must not leave a file behind.
      const mapImage = picture && {
        ...imageSize(picture.bytes),
        asset: await repository.importMapAsset(legacyId(legacy.Name), picture.name, picture.bytes, pack),
      };
      const { doc, warnings } = convertLegacyMap(legacy, mapImage);
      await repository.save('map', doc, pack);
      report.warnings.push(...warnings.map((w) => ({ file, message: w })));
      report.imported.maps += 1;
    });
  }
  for (const { file, doc } of plan.markers) {
    await step(file, async () => {
      await repository.save('marker', doc, pack);
      report.imported.areaTemplates += 1;
    });
  }
  return report;
}
