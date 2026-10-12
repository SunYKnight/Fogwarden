import {
  AURORA_ITEM_TYPES,
  AURORA_MAGIC_ITEM,
  AURORA_SPELL,
  auroraElementsOfType,
  auroraItem,
  auroraSpell,
  indexAuroraElements,
  type AuroraIndex,
} from '@/core/import/aurora';
import { auroraCharacter, type AuroraCharacter } from '@/core/import/auroraCharacter';
import type { Item } from '@/core/items';
import type { AssetRef } from '@/core/model';
import type { Spell } from '@/core/spells';
import { PACKS_DIR, type PackManifest } from './packs';
import { KIND_LAYOUTS, PORTRAITS_DIR, type Repository } from './repository';
import type { DirEntry } from './storage';

/**
 * Aurora Builder import: the builder's documents folder (`custom/**\/*.xml` element files, `*.dnd5e`
 * characters, `portraits/`) into the user pack "Aurora Builder". Its book content stays in the user's data root;
 * re-importing replaces the pack's files, so level-ups and changed elements arrive and removed ones go.
 */

/** Absolute-path file access to the picked folder (desktop: `listFolder`/`readFileText`/`readFileBytes`). */
export interface AuroraSource {
  list(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

export const AURORA_PACK: PackManifest = {
  id: 'aurora-builder',
  name: 'Aurora Builder',
  version: '',
  author: '',
  license: 'see source books',
  description:
    'Imported from Aurora Builder on this computer: characters, items, magic items, spells and portraits. ' +
    'The content belongs to its source books; it is for your own use and never shared.',
  url: 'https://www.aurorabuilder.com',
};

const PICTURE = /\.(png|jpe?g|webp)$/i;

export class AuroraFolderError extends Error {
  constructor(folder: string) {
    super(`"${folder}" holds no Aurora Builder data: expected a custom folder, a portraits folder or .dnd5e files`);
    this.name = 'AuroraFolderError';
  }
}

export interface AuroraProblem {
  file: string;
  message: string;
}

export interface AuroraPlan {
  folder: string;
  items: Item[];
  magicItems: Item[];
  spells: Spell[];
  characters: (AuroraCharacter & { file: string })[];
  /** Picture file names in the folder's `portraits/`. */
  portraits: string[];
  problems: AuroraProblem[];
}

export interface AuroraReport {
  characters: number;
  items: number;
  magicItems: number;
  spells: number;
  portraits: number;
  /** Files of an earlier import that this one no longer has. */
  removed: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** File name a portrait gets in the pack: characters outside letters, digits, `.`, `-`, `_` and spaces become `_`. */
export function portraitFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_');
}

async function xmlFiles(source: AuroraSource, dir: string): Promise<string[]> {
  const entries = await source.list(dir);
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDir
        ? xmlFiles(source, `${dir}/${e.name}`)
        : Promise.resolve(/\.xml$/i.test(e.name) ? [`${dir}/${e.name}`] : []),
    ),
  );
  return nested.flat().sort();
}

/** Reads and maps everything in `folder` without writing; unreadable files are listed as problems. */
export async function planAuroraImport(source: AuroraSource, folder: string): Promise<AuroraPlan> {
  const top = await source.list(folder);
  const has = (name: string) => top.some((e) => e.isDir && e.name.toLowerCase() === name);
  const characterFiles = top.filter((e) => !e.isDir && /\.dnd5e$/i.test(e.name)).map((e) => e.name);
  if (!has('custom') && !has('portraits') && characterFiles.length === 0) {
    throw new AuroraFolderError(folder);
  }
  const problems: AuroraProblem[] = [];
  const index: AuroraIndex = new Map();
  for (const file of has('custom') ? await xmlFiles(source, `${folder}/custom`) : []) {
    try {
      indexAuroraElements(index, await source.readText(file));
    } catch (error) {
      problems.push({ file: file.slice(folder.length + 1), message: errorMessage(error) });
    }
  }
  const characters: AuroraPlan['characters'] = [];
  for (const file of characterFiles) {
    try {
      characters.push({ ...auroraCharacter(await source.readText(`${folder}/${file}`), file, index), file });
    } catch (error) {
      problems.push({ file, message: errorMessage(error) });
    }
  }
  const portraits = has('portraits')
    ? (await source.list(`${folder}/portraits`)).filter((e) => !e.isDir && PICTURE.test(e.name)).map((e) => e.name)
    : [];
  return {
    folder,
    items: auroraElementsOfType(index, AURORA_ITEM_TYPES).map((e) => auroraItem(e, index)),
    magicItems: auroraElementsOfType(index, [AURORA_MAGIC_ITEM]).map((e) => auroraItem(e, index)),
    spells: auroraElementsOfType(index, [AURORA_SPELL]).map((e) => auroraSpell(e, index)),
    characters,
    portraits,
    problems,
  };
}

/** Deletes the files in `dir` of the Aurora pack that `keep` rejects; returns how many. */
async function removeStale(repository: Repository, dir: string, keep: (name: string) => boolean): Promise<number> {
  const stale = (await repository.storage.list('data', dir)).filter((e) => !e.isDir && !keep(e.name));
  await Promise.all(stale.map((e) => repository.storage.remove(`${dir}/${e.name}`)));
  return stale.length;
}

/**
 * Writes the plan into the pack "Aurora Builder": portraits, items, spells, then characters (their portrait
 * from the folder by file name, else the picture embedded in the character file); then removes what an earlier
 * import left that this one did not write.
 */
export async function runAuroraImport(
  plan: AuroraPlan,
  source: AuroraSource,
  repository: Repository,
  onProgress: (done: number, total: number) => void,
): Promise<AuroraReport> {
  await repository.ensurePack(AURORA_PACK);
  const root = `${PACKS_DIR}/${AURORA_PACK.id}`;
  const portraitDir = `${root}/${PORTRAITS_DIR}`;
  const items = [...plan.items, ...plan.magicItems];
  const total = plan.portraits.length + items.length + plan.spells.length + plan.characters.length;
  let done = 0;
  const step = () => {
    done += 1;
    onProgress(done, total);
  };
  const portraits = new Map<string, AssetRef>();
  for (const name of plan.portraits) {
    const ref: AssetRef = { area: 'data', path: `${portraitDir}/${portraitFileName(name)}` };
    await repository.storage.writeBytes(ref.path, await source.readBytes(`${plan.folder}/portraits/${name}`));
    portraits.set(name.toLowerCase(), ref);
    step();
  }
  for (const item of items) {
    await repository.save('item', item, AURORA_PACK.id);
    step();
  }
  for (const spell of plan.spells) {
    await repository.save('spell', spell, AURORA_PACK.id);
    step();
  }
  const kept = new Set([...portraits.values()].map((r) => r.path.slice(portraitDir.length + 1)));
  for (const { creature, portraitFile, portraitPng } of plan.characters) {
    let image = portraitFile ? (portraits.get(portraitFile.toLowerCase()) ?? null) : null;
    if (!image && portraitPng) {
      image = { area: 'data', path: `${portraitDir}/${creature.id}.png` };
      await repository.storage.writeBytes(image.path, portraitPng);
      kept.add(`${creature.id}.png`);
    }
    await repository.save('creature', { ...creature, image }, AURORA_PACK.id);
    step();
  }
  const ids = (docs: { id: string }[]) => new Set(docs.map((d) => d.id));
  const itemIds = ids(items);
  const spellIds = ids(plan.spells);
  const characterIds = ids(plan.characters.map((c) => c.creature));
  const idOf = (name: string, suffix: string) => (name.endsWith(suffix) ? name.slice(0, -suffix.length) : '');
  const removed = await Promise.all([
    removeStale(repository, portraitDir, (name) => kept.has(name)),
    removeStale(repository, `${root}/${KIND_LAYOUTS.item.dir}`, (name) => itemIds.has(idOf(name, '.md'))),
    removeStale(repository, `${root}/${KIND_LAYOUTS.spell.dir}`, (name) => spellIds.has(idOf(name, '.md'))),
    // Character pictures are `<id>.<ext>` beside `<id>.txt`.
    removeStale(repository, `${root}/${KIND_LAYOUTS.creature.dir}`, (name) => characterIds.has(name.split('.')[0]!)),
  ]);
  return {
    characters: plan.characters.length,
    items: plan.items.length,
    magicItems: plan.magicItems.length,
    spells: plan.spells.length,
    portraits: plan.portraits.length,
    removed: removed.reduce((a, b) => a + b, 0),
  };
}
