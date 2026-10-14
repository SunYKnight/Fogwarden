import { z } from 'zod';
import { errorMessage } from '@/core/errors';
import type { AssetRef } from '@/core/model';
import { MY_CONTENT_SOURCE, remapJsonAssets } from './packs';
import { libraryDir, SETTINGS_PATH, type LoadProblem, type Repository } from './repository';

/**
 * One-time move of a data root to content packs, while `settings.json` is older than v7 (or missing): asset
 * references to shipped files follow them into their packs (`content/creatures/…` →
 * `content/packs/srd/creatures/…` and so on). A rewritten document is read back and restored on a mismatch;
 * any problem leaves the settings version, so the next start tries again.
 */

const PACKS_SETTINGS_VERSION = 7;

/** Old content folder → its pack folder; shipped content was split into packs. */
const CONTENT_MOVES: [string, string][] = [
  ['creatures/', 'packs/srd/creatures/'],
  ['markers/', 'packs/srd/markers/'],
  ['maps/', 'packs/sample-map/maps/'],
  ['models/cc0/', 'packs/cc0-models/models/'],
];

async function needsMigration(repository: Repository): Promise<boolean> {
  const { storage } = repository;
  const exists = await storage.exists('data', SETTINGS_PATH);
  const version = exists
    ? z.object({ version: z.number() }).parse(JSON.parse(await storage.readText('data', SETTINGS_PATH))).version
    : 0;
  return version < PACKS_SETTINGS_VERSION;
}

class PackMigration {
  readonly problems: LoadProblem[] = [];

  constructor(private readonly repository: Repository) {}

  private get storage() {
    return this.repository.storage;
  }

  private problem(path: string, error: unknown): void {
    this.problems.push({ area: 'data', path, message: `Not moved into packs yet: ${errorMessage(error)}` });
  }

  /** Where a reference points after the move; unchanged when nothing moved. */
  remap(ref: AssetRef): AssetRef {
    const move = ref.area === 'content' ? CONTENT_MOVES.find(([from]) => ref.path.startsWith(from)) : undefined;
    return { area: ref.area, path: move ? move[1] + ref.path.slice(move[0].length) : ref.path };
  }

  /** Rewrites the asset references of one JSON document in place; restores it if the result reads back wrong. */
  async rewrite(path: string): Promise<void> {
    const before = await this.storage.readText('data', path);
    try {
      const after = remapJsonAssets(before, (r) => this.remap(r));
      if (after !== null) {
        await this.storage.writeText(path, after);
        if ((await this.storage.readText('data', path)) !== after) {
          await this.storage.writeText(path, before);
          throw new Error('the rewritten file reads back differently');
        }
      }
    } catch (error) {
      this.problem(path, error);
    }
  }
}

/** Documents that may hold asset references: maps, Dungeon Alchemist choices and encounters. */
async function referencingDocuments(repository: Repository): Promise<string[]> {
  const { storage } = repository;
  const maps = libraryDir('map', MY_CONTENT_SOURCE);
  const mapFiles = (await storage.list('data', maps)).filter((e) => e.isDir).map((e) => `${maps}/${e.name}/map.json`);
  const campaigns = (await storage.list('data', 'campaigns')).filter((e) => e.isDir);
  const encounters = await Promise.all(
    campaigns.map(async (c) =>
      (await storage.list('data', `campaigns/${c.name}/encounters`))
        .filter((e) => e.isDir)
        .map((e) => `campaigns/${c.name}/encounters/${e.name}/encounter.json`),
    ),
  );
  const candidates = [...mapFiles, 'library/dungeon-alchemist-objects.json', ...encounters.flat()];
  const present = await Promise.all(candidates.map((path) => storage.exists('data', path)));
  return candidates.filter((_path, i) => present[i]);
}

/** Moves the data root to packs once; returns what could not be moved (retried on the next start). */
export async function migrateToPacks(repository: Repository): Promise<LoadProblem[]> {
  let problems: LoadProblem[] = [];
  if (await needsMigration(repository)) {
    const run = new PackMigration(repository);
    for (const path of await referencingDocuments(repository)) {
      await run.rewrite(path);
    }
    if (run.problems.length === 0) {
      await repository.saveSettings(await repository.loadSettings());
    }
    problems = run.problems;
  }
  return problems;
}
