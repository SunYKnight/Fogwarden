import { damMargin, type DamProject } from '@/core/import/damProject';
import {
  DAM_OBJECTS_PATH,
  damObjectChoicesSchema,
  damObjectKinds,
  damProps,
  emptyDamObjectChoices,
  type DamObjectChoices,
  type PlacedKind,
} from '@/core/import/damObjects';
import { parseJsonFile, parseOrThrow } from '@/core/import/importedMap';
import type { AssetRef, Grid, MapImage, Prop, Vec2 } from '@/core/model';
import { fitSquaresToImage, type GridCalibration } from '@/core/terrain/calibration';
import { mapAssetRef, type Repository } from '@/data/repository';
import { importFile, listFolder, readFileText } from '@/data/tauriStorage';
import { worldToImagePx } from '@/render/projection';
import { modelSideFiles } from '@/sync/relayClient';

/** Models the DM picked for Dungeon Alchemist objects, one folder per model with its side files. */
const LIBRARY_MODELS = 'library/dungeon-alchemist-models';
const MODEL_FILE = /\.(glb|gltf)$/i;
/** glTF models made for general use are in meters. */
export const METERS_TO_FEET = 3.28084;
/** Models made for Dungeon Alchemist: one unit is one square. */
export const DA_UNIT_FT = 5;
// Model file names may carry characters storage paths refuse.
const UNSAFE = /[^\w.\- ]+/g;

export interface ModelOption {
  label: string;
  model: AssetRef;
  /** Feet per model unit proposed when the DM picks this model. */
  unitFt: number;
}

/**
 * Shipped CC0 stand-ins (pack `content/packs/cc0-models`, sources in its LICENSE.md). Kenney models use small
 * abstract units, so each scale gives a believable size: trees about 22-25 ft, a table 2.5 ft high.
 */
export const CC0_MODELS: ModelOption[] = [
  { label: 'Pine tree', file: 'tree-pine.glb', unitFt: 15 },
  { label: 'Round tree', file: 'tree-round.glb', unitFt: 15 },
  { label: 'Thin tree', file: 'tree-thin.glb', unitFt: 15 },
  { label: 'Bush', file: 'bush.glb', unitFt: 12 },
  { label: 'Rock', file: 'rock.glb', unitFt: 12 },
  { label: 'Crate', file: 'crate.glb', unitFt: 3 },
  { label: 'Barrel', file: 'barrel.glb', unitFt: 2.5 },
  { label: 'Table', file: 'table.glb', unitFt: 7.5 },
  { label: 'Chair', file: 'chair.glb', unitFt: 6.5 },
  { label: 'Bed', file: 'bed.glb', unitFt: 6 },
  { label: 'Chest', file: 'chest.glb', unitFt: 1.75 },
].map(({ label, file, unitFt }): ModelOption => ({
  label,
  model: { area: 'content', path: `packs/cc0-models/models/${file}` },
  unitFt,
}));

export async function loadDamObjectChoices(repository: Repository): Promise<DamObjectChoices> {
  const { storage } = repository;
  return (await storage.exists('data', DAM_OBJECTS_PATH))
    ? parseOrThrow(
        damObjectChoicesSchema,
        parseJsonFile(await storage.readText('data', DAM_OBJECTS_PATH), DAM_OBJECTS_PATH),
        DAM_OBJECTS_PATH,
        'Dungeon Alchemist object list',
      )
    : emptyDamObjectChoices();
}

export function saveDamObjectChoices(repository: Repository, choices: DamObjectChoices): Promise<void> {
  return repository.storage.writeText(DAM_OBJECTS_PATH, `${JSON.stringify(choices, null, 2)}\n`);
}

/** Models imported into the library earlier: the first glTF file of each model folder. */
export async function listLibraryModels(repository: Repository): Promise<ModelOption[]> {
  const { storage } = repository;
  // Listing a missing folder gives no entries on every storage.
  const folders = (await storage.list('data', LIBRARY_MODELS)).filter((e) => e.isDir);
  const options = await Promise.all(
    folders.map(async ({ name }): Promise<ModelOption[]> => {
      const file = (await storage.list('data', `${LIBRARY_MODELS}/${name}`)).find((e) => MODEL_FILE.test(e.name));
      return file
        ? [{ label: name, model: { area: 'data', path: `${LIBRARY_MODELS}/${name}/${file.name}` }, unitFt: DA_UNIT_FT }]
        : [];
    }),
  );
  return options.flat();
}

function modelFolder(fileName: string): string {
  return `${LIBRARY_MODELS}/${fileName.replace(MODEL_FILE, '').replace(UNSAFE, '_')}`;
}

/** Copies picked files (a .glb, or a .gltf with its buffers and textures) into the library. */
export async function importModelFiles(repository: Repository, files: File[]): Promise<ModelOption> {
  const model = files.find((f) => MODEL_FILE.test(f.name));
  if (!model) {
    throw new Error('Choose a .glb or .gltf file');
  }
  const folder = modelFolder(model.name);
  await Promise.all(
    files.map(async (f) =>
      repository.storage.writeBytes(`${folder}/${f.name.replace(UNSAFE, '_')}`, new Uint8Array(await f.arrayBuffer())),
    ),
  );
  return {
    label: model.name.replace(MODEL_FILE, ''),
    model: { area: 'data', path: `${folder}/${model.name.replace(UNSAFE, '_')}` },
    unitFt: METERS_TO_FEET,
  };
}

/** glTF files in a picked folder and its direct subfolders, as absolute paths (desktop only). */
export async function listFolderModels(folder: string): Promise<string[]> {
  const entries = await listFolder(folder);
  const nested = await Promise.all(
    entries
      .filter((e) => e.isDir)
      .map(async (dir) =>
        (await listFolder(`${folder}/${dir.name}`))
          .filter((e) => !e.isDir && MODEL_FILE.test(e.name))
          .map((e) => `${folder}/${dir.name}/${e.name}`),
      ),
  );
  const direct = entries.filter((e) => !e.isDir && MODEL_FILE.test(e.name)).map((e) => `${folder}/${e.name}`);
  return [...direct, ...nested.flat()];
}

/** Copies a model file from a picked folder, with the files a .gltf references, into the library. */
export async function importFolderModel(repository: Repository, absolutePath: string): Promise<ModelOption> {
  const slash = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'));
  const [dir, fileName] = [absolutePath.slice(0, slash), absolutePath.slice(slash + 1)];
  const folder = modelFolder(fileName);
  const model: AssetRef = { area: 'data', path: `${folder}/${fileName.replace(UNSAFE, '_')}` };
  const sides = /\.gltf$/i.test(fileName)
    ? modelSideFiles(
        { area: 'data', path: `${folder}/${fileName}` },
        new TextEncoder().encode(await readFileText(absolutePath)),
      )
    : [];
  await importFile(absolutePath, model.path);
  await Promise.all(sides.map((side) => importFile(`${dir}/${side.ref.path.slice(folder.length + 1)}`, side.ref.path)));
  return { label: fileName.replace(MODEL_FILE, ''), model, unitFt: DA_UNIT_FT };
}

/** Copies a model and the files it references next to the map; returns the map's copy. */
async function copyModelToMap(repository: Repository, model: AssetRef, mapId: string): Promise<AssetRef> {
  const { storage } = repository;
  const parts = model.path.split('/');
  const dir = parts.slice(0, -1).join('/');
  const target = (path: string) => mapAssetRef(mapId, `models/${parts.at(-2)}/${path.slice(dir.length + 1)}`);
  const sides = modelSideFiles(model, await storage.readBytes(model.area, model.path)).map((side) => side.ref);
  await Promise.all([model, ...sides].map((ref) => storage.copy(ref.area, ref.path, target(ref.path).path)));
  return target(model.path);
}

/** Places the project's objects with the DM's models; each model is copied to the map once. */
export function damPropsFor(
  repository: Repository,
  project: DamProject,
  choices: DamObjectChoices,
): (mapId: string, grid: Grid) => Promise<Prop[]> {
  return async (mapId, grid) => {
    const margin = damMargin(project, grid);
    const kinds: Record<string, PlacedKind> = {};
    const copies = new Map<string, Promise<AssetRef>>();
    await Promise.all(
      damObjectKinds(project).map(async ({ blockId }) => {
        const choice = choices.objects[blockId];
        if (choice?.model) {
          const key = `${choice.model.area}/${choice.model.path}`;
          const copy = copies.get(key) ?? copyModelToMap(repository, choice.model, mapId);
          copies.set(key, copy);
          kinds[blockId] = { ...choice, model: await copy };
        }
      }),
    );
    return damProps(project, margin, grid.feetPerSquare, kinds);
  };
}

/**
 * Image pixels of every object of the kind on the export's picture placed with `calibration`, so
 * the DM sees where the kind stands before choosing a model for it.
 */
export function damObjectPixels(
  project: DamProject,
  blockId: string,
  image: Pick<MapImage, 'widthPx' | 'heightPx'>,
  calibration: GridCalibration,
): Vec2[] {
  const margin = damMargin(project, fitSquaresToImage(image, calibration.pxPerSquare));
  // A Dungeon Alchemist unit is one square, so its feet are the map's.
  const grid = { ...calibration, feetPerSquare: DA_UNIT_FT };
  return project.objects
    .filter((o) => o.blockId === blockId)
    .map((o) =>
      worldToImagePx(grid, { x: o.position.x + margin.x * DA_UNIT_FT, y: o.position.y + margin.y * DA_UNIT_FT }),
    );
}
