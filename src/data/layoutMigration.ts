import { z } from 'zod';
import {
  assetRefSchema,
  campaignFileSchema,
  campaignSchema,
  creatureSchema,
  CREATURE_SCHEMA_VERSION,
  encounterSchema,
  mapFileSchema,
  mapSchema,
  type AssetRef,
  type BattleMap,
  type Campaign,
  type Creature,
} from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { decodeHeightmap } from '@/core/terrain/heightmap';
import { migrate } from './migrations';
import {
  campaignNotesPath,
  campaignPath,
  encounterDir,
  storableFog,
  type LoadProblem,
  type PictureKind,
  type Repository,
} from './repository';

/**
 * One-time conversion of a data root written before the open file layout: creature JSON → stat block text
 * with pictures by file name, `library/portraits.json` → pictures by file name, map heights → `terrain.png`,
 * encounter files → encounter folders with fog masks, campaign notes → `notes.md`. Every document is written
 * in the new layout first, read back and compared with the old one; only then is the old file replaced or
 * deleted. A document that fails keeps its old file and becomes a load problem.
 */

const CREATURES = 'library/creatures';
const PORTRAITS_PATH = 'library/portraits.json';
const OLD_PICTURES = `${CREATURES}/assets`;

const portraitIndexSchema = z.object({
  schema: z.literal('portraits'),
  version: z.literal(1),
  portraits: z.record(z.string(), z.object({ image: assetRefSchema.nullable(), token: assetRefSchema.nullable() })),
});

type Pictures = Pick<Creature, PictureKind>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JSON with object keys sorted, so equal documents compare equal whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

function requireSame(actual: unknown, expected: unknown, what: string): void {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${what} reads back differently than the old document`);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

class LayoutMigration {
  readonly problems: LoadProblem[] = [];
  /** Old creature picture path → its new convention file, for combatant tokens that point at it. */
  readonly moved = new Map<string, AssetRef>();

  constructor(private readonly repository: Repository) {}

  private get storage() {
    return this.repository.storage;
  }

  /** Runs one document's conversion; a failure is recorded under `path` and the old file stays. */
  async convert(path: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.problems.push({ area: 'data', path, message: `Kept in the old format: ${errorMessage(error)}` });
    }
  }

  private async readJson(path: string): Promise<unknown> {
    return JSON.parse(await this.storage.readText('data', path)) as unknown;
  }

  /** Removes the files a failed conversion created, keeping everything that was there before. */
  private async removeNew(dir: string, before: Set<string>, belongs: (name: string) => boolean) {
    const created = (await this.storage.list('data', dir)).filter((e) => belongs(e.name) && !before.has(e.name));
    await Promise.all(created.map((e) => this.storage.remove(`${dir}/${e.name}`)));
  }

  /** Stores pictures under `id`'s convention names and checks the copies byte for byte. */
  private async movePictures(id: string, pictures: Pictures): Promise<void> {
    const stored = await this.repository.storeCreaturePictures(id, pictures);
    for (const kind of ['image', 'token'] as const) {
      const from = pictures[kind];
      const to = stored[kind];
      const same =
        from === null ||
        (to !== null &&
          sameBytes(
            await this.storage.readBytes(from.area, from.path),
            await this.storage.readBytes(to.area, to.path),
          ));
      if (!same) {
        throw new Error(`the ${kind} picture ${from.path} was not copied intact`);
      }
      if (from && to && from.area === 'data' && from.path !== to.path) {
        this.moved.set(from.path, to);
      }
    }
  }

  private async withCreatureCleanup(id: string, run: () => Promise<void>): Promise<void> {
    const before = new Set((await this.storage.list('data', CREATURES)).map((e) => e.name));
    try {
      await run();
    } catch (error) {
      await this.removeNew(CREATURES, before, (name) => name.startsWith(`${id}.`));
      throw error;
    }
  }

  async creature(id: string, portrait: Pictures | undefined): Promise<void> {
    const oldPath = `${CREATURES}/${id}.json`;
    const old = creatureSchema.parse(migrate('creature', await this.readJson(oldPath), 1));
    const expected = { ...old, version: CREATURE_SCHEMA_VERSION, image: null, token: null };
    // The index only pictured creatures without pictures of their own.
    const pictures = old.image || old.token ? { image: old.image, token: old.token } : portrait;
    await this.withCreatureCleanup(id, async () => {
      await this.repository.storeCreature(expected);
      const reread = await this.repository.load('creature', { area: 'data', id });
      requireSame({ ...reread, image: null, token: null }, expected, 'The stat block text');
      await this.movePictures(id, pictures ?? { image: null, token: null });
    });
    await this.storage.remove(oldPath);
  }

  async portrait(id: string, pictures: Pictures): Promise<void> {
    await this.withCreatureCleanup(id, () => this.movePictures(id, pictures));
  }

  /** Version of a JSON document; documents of the current layout are left alone. */
  private async version(path: string): Promise<{ raw: unknown; version: number }> {
    const raw = await this.readJson(path);
    return { raw, version: z.object({ version: z.number() }).parse(raw).version };
  }

  async map(id: string): Promise<void> {
    const dir = `library/maps/${id}`;
    const { raw, version } = await this.version(`${dir}/map.json`);
    if (version === 1) {
      // The new layout is v2; later steps are pure and run on top of it.
      await this.convertMap(dir, mapSchema.parse(migrate('map', { ...migrate('map', raw, 1), version: 2 })));
    }
  }

  private async convertMap(dir: string, expected: BattleMap): Promise<void> {
    const { json, terrain } = await this.repository.mapFiles(expected);
    const terrainPath = `${dir}/terrain.png`;
    await this.storage.writeBytes(terrainPath, terrain);
    try {
      const file = mapFileSchema.parse(JSON.parse(json));
      const { heightmap, ...fileTerrain } = file.terrain;
      const { heights: _inPng, ...oldTerrain } = expected.terrain;
      requireSame({ ...file, terrain: fileTerrain }, { ...expected, terrain: oldTerrain }, 'map.json');
      const field = HeightField.fromMap(expected);
      const png = await this.storage.readBytes('data', terrainPath);
      const heights = await decodeHeightmap(png, heightmap, field.cols, field.rows);
      // Quantizing to the heightmap's step moves a height by at most half a step.
      const tolerance = heightmap.feetPerUnit / 2 + 1e-9;
      const off = field.data.findIndex((h, i) => Math.abs(h - heights[i]!) > tolerance);
      if (off !== -1) {
        throw new Error(`terrain.png height ${heights[off]} differs from ${field.data[off]} at sample ${off}`);
      }
    } catch (error) {
      await this.storage.remove(terrainPath);
      throw error;
    }
    await this.storage.writeText(`${dir}/map.json`, json);
  }

  async campaign(id: string): Promise<void> {
    const { raw, version } = await this.version(campaignPath(id));
    if (version === 1) {
      // The new layout is v2; later steps are pure and run on top of it.
      const upgraded = migrate('campaign', { ...migrate('campaign', raw, 1), version: 2 });
      await this.convertCampaign(id, campaignSchema.parse(upgraded));
    }
  }

  private async convertCampaign(id: string, expected: Campaign): Promise<void> {
    const notesPath = campaignNotesPath(id);
    await this.storage.writeText(notesPath, expected.notes);
    try {
      requireSame(await this.storage.readText('data', notesPath), expected.notes, 'notes.md');
    } catch (error) {
      await this.storage.remove(notesPath);
      throw error;
    }
    await this.storage.writeText(campaignPath(id), `${JSON.stringify(campaignFileSchema.parse(expected), null, 2)}\n`);
  }

  async encounter(campaignId: string, id: string): Promise<void> {
    const oldPath = `campaigns/${campaignId}/encounters/${id}.json`;
    const old = migrate('encounter', await this.readJson(oldPath), 2);
    // The folder layout is v3; later steps are pure and run on top of it.
    const upgraded = encounterSchema.parse(migrate('encounter', { ...old, version: 3 }));
    const combatants = upgraded.combatants.map((c) => ({
      ...c,
      token: c.token && (this.moved.get(c.token.path) ?? c.token),
    }));
    const expected = { ...upgraded, combatants };
    const dir = encounterDir(campaignId, id);
    try {
      await this.repository.storeEncounter(expected);
      const reread = await this.repository.loadEncounter(campaignId, id);
      const size = await this.repository.encounterFogSize(expected);
      requireSame(reread, { ...expected, fog: storableFog(expected.fog, size) }, 'The encounter folder');
    } catch (error) {
      await this.storage.remove(dir);
      throw error;
    }
    await this.storage.remove(oldPath);
  }

  /** Deletes old creature pictures that were copied, once nothing can point at them any more. */
  async removeMovedPictures(): Promise<void> {
    await Promise.all([...this.moved.keys()].map((path) => this.storage.remove(path)));
    if ((await this.storage.list('data', OLD_PICTURES)).length === 0) {
      await this.storage.remove(OLD_PICTURES);
    }
  }
}

/** Converts every old-layout document of the data root; returns the documents that kept their old files. */
export async function migrateDataRoot(repository: Repository): Promise<LoadProblem[]> {
  const storage = repository.storage;
  const run = new LayoutMigration(repository);
  const index = (await storage.exists('data', PORTRAITS_PATH))
    ? portraitIndexSchema.parse(JSON.parse(await storage.readText('data', PORTRAITS_PATH))).portraits
    : {};
  const creatureIds = (await storage.list('data', CREATURES))
    .filter((e) => !e.isDir && e.name.endsWith('.json'))
    .map((e) => e.name.slice(0, -'.json'.length));
  for (const id of creatureIds) {
    await run.convert(`${CREATURES}/${id}.json`, () => run.creature(id, index[id]));
  }
  for (const [id, pictures] of Object.entries(index).filter(([id]) => !creatureIds.includes(id))) {
    await run.convert(`${CREATURES}/${id}`, () => run.portrait(id, pictures));
  }
  // Folders of the current layout always hold terrain.png and notes.md.
  for (const map of (await storage.list('data', 'library/maps')).filter((e) => e.isDir)) {
    if (!(await storage.exists('data', `library/maps/${map.name}/terrain.png`))) {
      await run.convert(`library/maps/${map.name}/map.json`, () => run.map(map.name));
    }
  }
  for (const campaign of (await storage.list('data', 'campaigns')).filter((e) => e.isDir)) {
    if (!(await storage.exists('data', campaignNotesPath(campaign.name)))) {
      await run.convert(campaignPath(campaign.name), () => run.campaign(campaign.name));
    }
    const encounters = (await storage.list('data', `campaigns/${campaign.name}/encounters`)).filter(
      (e) => !e.isDir && e.name.endsWith('.json'),
    );
    for (const file of encounters) {
      const id = file.name.slice(0, -'.json'.length);
      await run.convert(`campaigns/${campaign.name}/encounters/${file.name}`, () => run.encounter(campaign.name, id));
    }
  }
  if (run.problems.length === 0 && Object.keys(index).length > 0) {
    await storage.remove(PORTRAITS_PATH);
  }
  if (run.problems.length === 0 && run.moved.size > 0) {
    await run.removeMovedPictures();
  }
  return run.problems;
}
