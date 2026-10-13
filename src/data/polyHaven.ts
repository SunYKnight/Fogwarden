import { z } from 'zod';
import type { StandInSlot } from '@/core/import/damCatalog';
import { gltfJsonSchema, simplifyVariant, splitGltfVariants } from '@/core/gltfDocument';
import type { AssetRef } from '@/core/model';
import { PACK_FILE, PACKS_DIR, type PackManifest } from './packs';
import type { Repository } from './repository';

export const POLY_HAVEN_PACK: PackManifest = {
  id: 'poly-haven',
  name: 'Poly Haven models',
  version: '1',
  author: 'Poly Haven artists (polyhaven.com)',
  license: 'CC0-1.0',
  description: 'Realistic plants, rocks and furniture; stand-ins for Dungeon Alchemist objects.',
  url: 'https://polyhaven.com/models',
};

const API = 'https://api.polyhaven.com';
const MODELS_DIR = `${PACKS_DIR}/${POLY_HAVEN_PACK.id}/models`;
// 1k textures keep about 20 models with three maps each near 300 MB of video
// memory; seen from above at battlemap scale 2k adds no visible detail.
const RESOLUTION = '1k';
// Poly Haven's scanned trees reach 700k triangles a variant; 30k keeps their
// look from the DM's camera and lets a map hold dozens.
const TRIANGLE_BUDGET = 30_000;

/**
 * Poly Haven model per stand-in slot. `set` models hold several variants side by side
 * (a row of ferns) and are split into one file per variant.
 */
const POLY_HAVEN_MODELS: { slot: StandInSlot; id: string; set: boolean }[] = [
  { slot: 'conifer', id: 'fir_sapling_medium', set: true },
  { slot: 'tree', id: 'searsia_burchellii', set: true },
  { slot: 'fern', id: 'fern_02', set: true },
  { slot: 'flower', id: 'dandelion_01', set: true },
  { slot: 'ivy', id: 'weed_plant_02', set: true },
  // Not shrub_04: 27k triangles a plant is too heavy for a forest of them.
  { slot: 'bush', id: 'shrub_03', set: true },
  { slot: 'branch', id: 'dry_branches_medium_01', set: true },
  { slot: 'log', id: 'dead_tree_trunk', set: false },
  { slot: 'stump', id: 'tree_stump_01', set: false },
  { slot: 'rock', id: 'rock_07', set: false },
  { slot: 'rock', id: 'namaqualand_boulder_02', set: false },
  { slot: 'table', id: 'WoodenTable_01', set: false },
  { slot: 'chair', id: 'gallinera_chair', set: false },
  { slot: 'barrel', id: 'wine_barrel_01', set: false },
  { slot: 'chest', id: 'treasure_chest', set: false },
  { slot: 'crate', id: 'wooden_crate_01', set: false },
  { slot: 'bed', id: 'GothicBed_01', set: false },
  { slot: 'shelf', id: 'wooden_bookshelf_worn', set: false },
  { slot: 'cabinet', id: 'vintage_wooden_drawer_01', set: false },
  // Not wooden_candlestick: it has 213k triangles.
  { slot: 'candle', id: 'vintage_oil_lamp', set: false },
  { slot: 'pot', id: 'planter_pot_clay', set: false },
  { slot: 'planter', id: 'planter_box_01', set: false },
  { slot: 'firepit', id: 'stone_fire_pit', set: false },
];

const fileSchema = z.object({ url: z.url(), size: z.number().int().nonnegative() });
const filesSchema = z.object({
  gltf: z.record(
    z.string(),
    z.object({ gltf: fileSchema.extend({ include: z.record(z.string(), fileSchema).default({}) }) }),
  ),
});
const infoSchema = z.object({ name: z.string(), authors: z.record(z.string(), z.string()) });

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Poly Haven download failed (HTTP ${response.status}): ${url}`);
  }
  return response;
}

interface PlannedModel {
  id: string;
  set: boolean;
  name: string;
  authors: string[];
  /** False when an earlier download already brought the model. */
  needed: boolean;
  gltfUrl: string;
  files: { path: string; url: string; size: number }[];
}

/** The model's downloaded `.gltf` files; the download writes them last, after its textures. */
async function downloadedVariants(repository: Repository, id: string): Promise<AssetRef[]> {
  const dir = `${MODELS_DIR}/${id}`;
  // Listing a missing folder gives no entries on every storage.
  const entries = await repository.storage.list('data', dir);
  return entries
    .filter((e) => !e.isDir && e.name.endsWith('.gltf'))
    .map((e): AssetRef => ({ area: 'data', path: `${dir}/${e.name}` }));
}

async function planModel(repository: Repository, { id, set }: { id: string; set: boolean }): Promise<PlannedModel> {
  const [files, info, present] = await Promise.all([
    fetchOk(`${API}/files/${id}`).then(async (r) => filesSchema.parse(await r.json())),
    fetchOk(`${API}/info/${id}`).then(async (r) => infoSchema.parse(await r.json())),
    downloadedVariants(repository, id),
  ]);
  const gltf = files.gltf[RESOLUTION]?.gltf;
  if (!gltf) {
    throw new Error(`Poly Haven has no ${RESOLUTION} glTF of "${id}"`);
  }
  const included = Object.entries(gltf.include).map(([path, file]) => ({ path, ...file }));
  const { name, authors } = info;
  const needed = present.length === 0;
  return { id, set, name, authors: Object.keys(authors), needed, gltfUrl: gltf.url, files: included };
}

/** Download size in bytes of the models still needed, for the confirmation. */
export function plannedBytes(plan: PlannedModel[]): number {
  const needed = plan.filter((m) => m.needed);
  return needed.reduce((sum, m) => sum + m.files.reduce((s, f) => s + f.size, 0), 0);
}

/** Every model of the pack, marked whether it still needs downloading; asks Poly Haven's public API. */
export function planPolyHaven(repository: Repository): Promise<PlannedModel[]> {
  return Promise.all(POLY_HAVEN_MODELS.map((model) => planModel(repository, model)));
}

/** How many models of the pack are not downloaded yet. */
export async function missingPolyHavenModels(repository: Repository): Promise<number> {
  const present = await Promise.all(POLY_HAVEN_MODELS.map(({ id }) => downloadedVariants(repository, id)));
  return present.filter((variants) => variants.length === 0).length;
}

function licenseText(plan: PlannedModel[]): string {
  const credits = plan.map((m) => `- ${m.name} by ${m.authors.join(', ')}: https://polyhaven.com/a/${m.id}`);
  return [
    '# Poly Haven models',
    '',
    'Downloaded from https://polyhaven.com under CC0 1.0 Universal',
    '(https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required; the artists:',
    '',
    ...credits,
    '',
  ].join('\n');
}

/**
 * Downloads the models still needed into the user pack "Poly Haven models", one folder per
 * model and one `.gltf` with its own `.bin` per variant (sets are split), simplified to
 * `TRIANGLE_BUDGET`; textures are shared. `onProgress` gets the bytes downloaded so far.
 */
export async function downloadPolyHaven(
  repository: Repository,
  plan: PlannedModel[],
  onProgress: (bytes: number) => void,
): Promise<void> {
  await repository.ensurePack(POLY_HAVEN_PACK);
  const { storage } = repository;
  let done = 0;
  // One file at a time keeps Poly Haven's servers and the progress readable.
  for (const model of plan.filter((m) => m.needed)) {
    const dir = `${MODELS_DIR}/${model.id}`;
    const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (const file of model.files) {
      const bytes = new Uint8Array(await (await fetchOk(file.url)).arrayBuffer());
      if (bytes.length !== file.size) {
        throw new Error(`Poly Haven sent ${bytes.length} of ${file.size} bytes for ${file.url}`);
      }
      resources[file.path] = bytes;
      done += file.size;
      onProgress(done);
    }
    const document = gltfJsonSchema.parse(await (await fetchOk(model.gltfUrl)).json());
    const variants = model.set ? splitGltfVariants(document) : [{ name: model.id, document }];
    const written = new Set<string>();
    for (const variant of variants) {
      const files = await simplifyVariant(variant, resources, TRIANGLE_BUDGET);
      // The .gltf goes last: its presence marks the model as downloaded.
      for (const [path, bytes] of Object.entries(files.resources).filter(([path]) => !written.has(path))) {
        await storage.writeBytes(`${dir}/${path}`, bytes);
        written.add(path);
      }
      await storage.writeText(`${dir}/${variant.name}.gltf`, files.gltf);
    }
  }
  await storage.writeText(`${PACKS_DIR}/${POLY_HAVEN_PACK.id}/LICENSE.md`, licenseText(plan));
}

/** The downloaded variants per slot; empty when the pack is not installed. */
export async function polyHavenStandIns(repository: Repository): Promise<Partial<Record<StandInSlot, AssetRef[]>>> {
  const installed = await repository.storage.exists('data', `${PACKS_DIR}/${POLY_HAVEN_PACK.id}/${PACK_FILE}`);
  const listed = await Promise.all(
    POLY_HAVEN_MODELS.map(async ({ slot, id }) => ({
      slot,
      models: installed ? await downloadedVariants(repository, id) : [],
    })),
  );
  const bySlot: Partial<Record<StandInSlot, AssetRef[]>> = {};
  listed.forEach(({ slot, models }) => {
    bySlot[slot] = [...(bySlot[slot] ?? []), ...models];
  });
  return bySlot;
}
