import { z } from 'zod';
import type { AssetRef } from '@/core/model';
import { LEGACY_PACK } from './legacyImport';
import { MY_CONTENT_SOURCE, packSource, remapJsonAssets } from './packs';
import { KIND_LAYOUTS, libraryDir, type LibraryKind, type LoadProblem, type Repository } from './repository';

/**
 * One-time move of a data root to content packs, while `settings.json` is older than v7 (or missing):
 * - documents of the legacy import (ids `legacy--…`) move from My content into the pack "Legacy DM Tool";
 * - asset references to shipped files follow them into their packs (`content/creatures/…` →
 *   `content/packs/srd/creatures/…` and so on) and references to moved legacy files follow those.
 * Every new file is read back and compared before an old one is deleted; a rewritten document is read back
 * and restored on a mismatch. Any problem keeps all old legacy files (My content still wins over the copies)
 * and leaves the settings version, so the next start tries again.
 */

const SETTINGS_PATH = 'settings.json';
const PACKS_SETTINGS_VERSION = 7;
const LEGACY_ID = /^legacy--/;
const PICTURE_FILE = /\.(png|jpe?g|webp)$/i;

/** Old content folder → its pack folder; shipped content was split into packs. */
const CONTENT_MOVES: [string, string][] = [
  ['creatures/', 'packs/srd/creatures/'],
  ['markers/', 'packs/srd/markers/'],
  ['maps/', 'packs/sample-map/maps/'],
  ['models/cc0/', 'packs/cc0-models/models/'],
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

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
  /** Old data path (file, or folder ending in '/') → new path, for files copied intact. */
  readonly moved = new Map<string, string>();

  constructor(private readonly repository: Repository) {}

  private get storage() {
    return this.repository.storage;
  }

  private problem(path: string, error: unknown): void {
    this.problems.push({ area: 'data', path, message: `Not moved into packs yet: ${errorMessage(error)}` });
  }

  /** Where a reference points after the move; unchanged when nothing moved. */
  remap(ref: AssetRef): AssetRef {
    const shipped = ref.area === 'content';
    const move = shipped ? CONTENT_MOVES.find(([from]) => ref.path.startsWith(from)) : undefined;
    const file = shipped ? undefined : this.moved.get(ref.path);
    const folder = shipped
      ? undefined
      : [...this.moved].find(([from]) => from.endsWith('/') && ref.path.startsWith(from));
    const moved = move ?? folder;
    const path = file ?? (moved ? moved[1] + ref.path.slice(moved[0].length) : ref.path);
    return { area: ref.area, path };
  }

  /** Copies one file, rewriting its asset references when it is JSON, and checks the copy. */
  private async copyFile(from: string, to: string, remapJson: boolean): Promise<void> {
    const original = await this.storage.readBytes('data', from);
    const remapped = remapJson ? remapJsonAssets(new TextDecoder().decode(original), (r) => this.remap(r)) : null;
    const bytes = remapped === null ? original : new TextEncoder().encode(remapped);
    await this.storage.writeBytes(to, bytes);
    if (!sameBytes(await this.storage.readBytes('data', to), bytes)) {
      throw new Error(`the copy ${to} differs from what was written`);
    }
  }

  /** Copies the legacy documents of `kind` into the legacy pack; returns the old paths to delete later. */
  async copyLegacy(kind: LibraryKind): Promise<string[]> {
    const fromDir = libraryDir(kind, MY_CONTENT_SOURCE);
    const toDir = libraryDir(kind, packSource('data', LEGACY_PACK.id));
    const { folder, file } = KIND_LAYOUTS[kind];
    const entries = (await this.storage.list('data', fromDir)).filter((e) => LEGACY_ID.test(e.name));
    const documents = entries.filter((e) => (folder ? e.isDir : !e.isDir && e.name.endsWith(file)));
    const copied: string[] = [];
    for (const doc of documents) {
      const id = folder ? doc.name : doc.name.slice(0, -file.length);
      // A creature's pictures are files named after it beside its text.
      const files = folder
        ? (await this.repository.listFiles('data', `${fromDir}/${id}`)).map((p) => p.slice(fromDir.length + 1))
        : entries
            .filter(
              (e) => !e.isDir && (e.name === doc.name || (e.name.startsWith(`${id}.`) && PICTURE_FILE.test(e.name))),
            )
            .map((e) => e.name);
      const oldPath = `${fromDir}/${doc.name}`;
      try {
        if (folder) {
          this.moved.set(`${oldPath}/`, `${toDir}/${doc.name}/`);
        }
        // Pictures before the JSON, whose references are rewritten to them.
        const ordered = [...files].sort((a, b) => Number(a.endsWith('.json')) - Number(b.endsWith('.json')));
        for (const name of ordered) {
          await this.copyFile(`${fromDir}/${name}`, `${toDir}/${name}`, name.endsWith('.json'));
          this.moved.set(`${fromDir}/${name}`, `${toDir}/${name}`);
        }
        copied.push(...(folder ? [oldPath] : files.map((name) => `${fromDir}/${name}`)));
      } catch (error) {
        this.moved.delete(`${oldPath}/`);
        files.forEach((name) => this.moved.delete(`${fromDir}/${name}`));
        this.problem(oldPath, error);
      }
    }
    return copied;
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
    const kinds: LibraryKind[] = ['creature', 'marker', 'map'];
    const legacyFiles: string[] = [];
    for (const kind of kinds) {
      legacyFiles.push(...(await run.copyLegacy(kind)));
    }
    if (legacyFiles.length > 0) {
      await repository.ensurePack(LEGACY_PACK);
    }
    // Legacy maps were rewritten while copied; their old files go below.
    const legacyMaps = `${libraryDir('map', MY_CONTENT_SOURCE)}/legacy--`;
    for (const path of (await referencingDocuments(repository)).filter((p) => !p.startsWith(legacyMaps))) {
      await run.rewrite(path);
    }
    if (run.problems.length === 0) {
      await Promise.all(legacyFiles.map((path) => repository.storage.remove(path)));
      await repository.saveSettings(await repository.loadSettings());
    }
    problems = run.problems;
  }
  return problems;
}
