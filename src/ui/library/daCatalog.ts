import { isTauri } from '@tauri-apps/api/core';
import { gltfSize } from '@/core/gltfDocument';
import {
  damStandIn,
  parseDamCatalog,
  suggestDamChoices,
  type DamCatalog,
  type DamStandInModel,
  type Size3,
  type StandInSlot,
} from '@/core/import/damCatalog';
import type { DamObjectChoices } from '@/core/import/damObjects';
import type { DamProject } from '@/core/import/damProject';
import type { AssetRef } from '@/core/model';
import { polyHavenStandIns } from '@/data/polyHaven';
import type { Repository } from '@/data/repository';
import { isFile, readFileText } from '@/data/tauriStorage';
import { readGltfJson } from '@/sync/relayClient';
import { CC0_MODELS } from './daObjects';

const DATABASE = 'Dungeon Alchemist_Data/StreamingAssets/Database';
const STEAM_ROOTS = ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam'];
const STEAM_GAME = 'steamapps/common/Dungeon Alchemist';

// Both files together are about 30 MB; read them once per folder and session.
const catalogs = new Map<string, Promise<DamCatalog | null>>();

/** Steam library folders: the Steam roots and every library `libraryfolders.vdf` lists. */
async function steamLibraries(): Promise<string[]> {
  const lists = STEAM_ROOTS.map((root) => `${root}/steamapps/libraryfolders.vdf`);
  const present = await Promise.all(lists.map(isFile));
  const texts = await Promise.all(lists.filter((_list, i) => present[i]).map(readFileText));
  const listed = texts.flatMap((text) => [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1]!));
  return [...STEAM_ROOTS, ...listed.map((path) => path.replaceAll('\\\\', '/'))];
}

/** Dungeon Alchemist's install folder: the located one, else the first Steam install found. */
async function findGameFolder(located: string | null): Promise<string | null> {
  const candidates = located !== null ? [located] : (await steamLibraries()).map((lib) => `${lib}/${STEAM_GAME}`);
  const present = await Promise.all(candidates.map((folder) => isFile(`${folder}/${DATABASE}/BuildingBlocks.json`)));
  return candidates.find((_folder, i) => present[i]) ?? null;
}

async function readCatalog(located: string | null): Promise<DamCatalog | null> {
  const folder = await findGameFolder(located);
  const [blocks, models] =
    folder === null
      ? [null, null]
      : await Promise.all([
          readFileText(`${folder}/${DATABASE}/BuildingBlocks.json`),
          readFileText(`${folder}/${DATABASE}/ModelStaticData.json`),
        ]);
  return blocks !== null && models !== null ? parseDamCatalog(blocks, models) : null;
}

/** Dungeon Alchemist's names and sizes per object kind, or null without an install (desktop only). */
export function loadDamCatalog(located: string | null): Promise<DamCatalog | null> {
  const key = located ?? '';
  const cached = catalogs.get(key);
  const load = cached ?? (isTauri() ? readCatalog(located) : Promise.resolve(null));
  if (!cached) {
    catalogs.set(key, load);
    // A failed read is retried next time; callers still get the error.
    load.catch(() => catalogs.delete(key));
  }
  return load;
}

/** Size of a stored model in its own units (x and z seen from above, y up), from its glTF JSON. */
export async function modelSize(repository: Repository, model: AssetRef): Promise<Size3> {
  return gltfSize(readGltfJson(model, await repository.storage.readBytes(model.area, model.path)));
}

/** Shipped Kenney stand-in per slot, used where the Poly Haven pack has none or is not downloaded. */
const KENNEY_SLOTS: Partial<Record<StandInSlot, string>> = {
  conifer: 'tree-pine',
  tree: 'tree-round',
  fern: 'bush',
  ivy: 'bush',
  bush: 'bush',
  rock: 'rock',
  table: 'table',
  chair: 'chair',
  barrel: 'barrel',
  chest: 'chest',
  crate: 'crate',
  bed: 'bed',
};

/** Stand-in variants with their sizes for the slots of the project's kinds. */
async function standInModels(
  repository: Repository,
  project: DamProject,
  catalog: DamCatalog,
): Promise<Partial<Record<StandInSlot, DamStandInModel[]>>> {
  const slots = new Set(
    project.objects.flatMap((o) => {
      const entry = catalog[o.blockId];
      const slot = entry ? damStandIn(entry) : null;
      return slot === null ? [] : [slot];
    }),
  );
  const downloaded = await polyHavenStandIns(repository);
  const entries = await Promise.all(
    [...slots].map(async (slot): Promise<[StandInSlot, DamStandInModel[]]> => {
      const kenney = KENNEY_SLOTS[slot];
      const fallback = CC0_MODELS.filter((o) => o.model.path.endsWith(`/${kenney}.glb`)).map((o) => o.model);
      const models = downloaded[slot]?.length ? downloaded[slot] : fallback;
      const sized = await Promise.all(
        models.map(async (model) => ({ model, size: await modelSize(repository, model) })),
      );
      return [slot, sized];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * `suggestDamChoices` with Dungeon Alchemist's database and the best downloaded or shipped
 * stand-ins; without an install, unknown kinds are added unnamed and skipped.
 */
export async function projectChoices(
  repository: Repository,
  project: DamProject,
  choices: DamObjectChoices,
  reassign: boolean,
): Promise<DamObjectChoices> {
  const catalog = (await loadDamCatalog(choices.gameFolder)) ?? {};
  const standIns = await standInModels(repository, project, catalog);
  return suggestDamChoices(project, choices, catalog, standIns, reassign);
}
