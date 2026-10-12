import { z } from 'zod';
import { base64ToBytes, float32ToBase64 } from '@/core/binary';
import { formatCreatureFile, parseCreatureFile } from '@/core/import/creatureFile';
import {
  campaignFileSchema,
  campaignSchema,
  creatureSchema,
  defaultSettings,
  encounterFileSchema,
  encounterSchema,
  gridSchema,
  mapFileSchema,
  mapSchema,
  markerTemplateSchema,
  newId,
  nowIso,
  settingsSchema,
  type AssetRef,
  type BattleMap,
  type Campaign,
  type Creature,
  type DocRef,
  type Encounter,
  type EncounterFile,
  type Fog,
  type MarkerTemplate,
  type Settings,
  type StorageArea,
} from '@/core/model';
import { readPngSize } from '@/core/png';
import { HeightField } from '@/core/terrain/heightfield';
import { decodeHeightmap, encodeHeightmap } from '@/core/terrain/heightmap';
import { fogSize, readFogBits, type FogSize } from '@/core/vision/fog';
import { decodeFogMask, encodeFogMask } from '@/core/vision/fogMask';
import { migrate } from './migrations';
import type { DirEntry, Storage } from './storage';

export type LibraryKind = 'creature' | 'marker' | 'map';

export interface LibraryDocs {
  creature: Creature;
  marker: MarkerTemplate;
  map: BattleMap;
}

const LIBRARY_DIRS: Record<LibraryKind, { data: string; content: string }> = {
  creature: { data: 'library/creatures', content: 'creatures' },
  marker: { data: 'library/markers', content: 'markers' },
  map: { data: 'library/maps', content: 'maps' },
};

const SETTINGS_PATH = 'settings.json';
const TERRAIN_FILE = 'terrain.png';
const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
/** `<id>.<ext>` is a creature's image, `<id>.token.<ext>` its token picture. */
const PICTURE_FILE = /^(.+?)(\.token)?\.(png|jpe?g|webp)$/i;

export type PictureKind = 'image' | 'token';
type Pictures = Pick<Creature, PictureKind>;

export interface LibraryEntry<K extends LibraryKind> {
  ref: DocRef;
  doc: LibraryDocs[K];
  /** True when a user copy in the data area shadows a shipped document with the same id. */
  overridesContent: boolean;
}

export interface LoadProblem {
  area: StorageArea;
  path: string;
  message: string;
}

export interface LibraryListing<K extends LibraryKind> {
  entries: LibraryEntry<K>[];
  problems: LoadProblem[];
}

export class DataError extends Error {
  constructor(
    message: string,
    readonly area: StorageArea,
    readonly path: string,
  ) {
    super(`${message} (${area}:${path})`);
    this.name = 'DataError';
  }
}

/** Maps are folders so their images, models and heightmap travel with them; creatures are stat block text. */
export function libraryDocPath(kind: LibraryKind, area: StorageArea, id: string): string {
  const dir = LIBRARY_DIRS[kind][area];
  const files: Record<LibraryKind, string> = { creature: `${id}.txt`, marker: `${id}.json`, map: `${id}/map.json` };
  return `${dir}/${files[kind]}`;
}

function mapDir(area: StorageArea, id: string): string {
  return `${LIBRARY_DIRS.map[area]}/${id}`;
}

export function mapAssetRef(mapId: string, fileName: string): AssetRef {
  return { area: 'data', path: `${mapDir('data', mapId)}/assets/${fileName}` };
}

/** Where a creature's picture of `kind` with the file extension `extension` lives by name convention. */
export function creaturePictureRef(area: StorageArea, id: string, kind: PictureKind, extension: string): AssetRef {
  const suffix = kind === 'token' ? '.token' : '';
  return { area, path: `${LIBRARY_DIRS.creature[area]}/${id}${suffix}.${extension.toLowerCase()}` };
}

export function campaignPath(id: string): string {
  return `campaigns/${id}/campaign.json`;
}

export function campaignNotesPath(id: string): string {
  return `campaigns/${id}/notes.md`;
}

export function encounterDir(campaignId: string, id: string): string {
  return `campaigns/${campaignId}/encounters/${id}`;
}

export function encounterPath(campaignId: string, id: string): string {
  return `${encounterDir(campaignId, id)}/encounter.json`;
}

/** Fog mask files of an encounter folder by the `Fog` bitset they hold. */
function fogMaskPaths(dir: string, fog: Pick<Fog, 'exploredBy'>) {
  return {
    explored: Object.fromEntries(Object.keys(fog.exploredBy).map((id) => [id, `${dir}/fog/explored/${id}.png`])),
    revealed: `${dir}/fog/revealed.png`,
    hidden: `${dir}/fog/hidden.png`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

/** A bitset that addresses the cells of `size`; others belong to a resized map and read as empty anyway. */
function fitsFog(base64: string, size: FogSize | null): boolean {
  return size !== null && base64 !== '' && base64ToBytes(base64).length === Math.ceil((size.cellsX * size.cellsY) / 8);
}

/** The fog a save keeps: bitsets that fit the map's fog grid; the rest read as empty anyway. */
export function storableFog(fog: Fog, size: FogSize | null): Fog {
  return {
    ...fog,
    exploredBy: Object.fromEntries(Object.entries(fog.exploredBy).filter(([, bits]) => fitsFog(bits, size))),
    revealedByDm: fitsFog(fog.revealedByDm, size) ? fog.revealedByDm : '',
    hiddenByDm: fitsFog(fog.hiddenByDm, size) ? fog.hiddenByDm : '',
  };
}

/** Pictures found by name in one listing of a creature folder, by creature id. */
function picturesIn(area: StorageArea, entries: DirEntry[]): Map<string, Pictures> {
  const pictures = new Map<string, Pictures>();
  for (const entry of entries.filter((e) => !e.isDir)) {
    const match = PICTURE_FILE.exec(entry.name);
    if (match) {
      const id = match[1]!;
      const kind: PictureKind = match[2] ? 'token' : 'image';
      const found = pictures.get(id) ?? { image: null, token: null };
      // Sorted listings make the first extension win when several exist.
      pictures.set(id, { ...found, [kind]: found[kind] ?? creaturePictureRef(area, id, kind, match[3]!) });
    }
  }
  return pictures;
}

export class Repository {
  /**
   * Documents the one-time layout migration (`migrateDataRoot`) could not convert; their old files stay
   * untouched and the listings report them.
   */
  layoutProblems: LoadProblem[] = [];

  constructor(readonly storage: Storage) {}

  private async parseFile<T>(area: StorageArea, path: string, parse: (text: string) => T | Promise<T>): Promise<T> {
    const text = await this.storage.readText(area, path);
    let parsed: T;
    try {
      parsed = await parse(text);
    } catch (error) {
      throw new DataError(errorMessage(error), area, path);
    }
    return parsed;
  }

  private readJson<T>(schemaName: 'marker' | 'settings', schema: z.ZodType<T>, area: StorageArea, path: string) {
    return this.parseFile(area, path, (text) => schema.parse(migrate(schemaName, JSON.parse(text))));
  }

  /** Pretty-printed with the schema's key order, so an unchanged document saves byte for byte the same. */
  private writeJson(path: string, doc: unknown): Promise<void> {
    return this.storage.writeText(path, `${JSON.stringify(doc, null, 2)}\n`);
  }

  /** Adds the layout migration's problems; they replace the listing's own ones for the same file. */
  private withLayoutProblems(problems: LoadProblem[], under: (path: string) => boolean): LoadProblem[] {
    const layout = this.layoutProblems.filter((p) => under(p.path));
    return [...problems.filter((p) => !layout.some((l) => l.path === p.path)), ...layout];
  }

  // --- creatures ---

  private async creatureFolders(): Promise<Record<StorageArea, DirEntry[]>> {
    const [data, content] = await Promise.all([
      this.storage.list('data', LIBRARY_DIRS.creature.data),
      this.storage.list('content', LIBRARY_DIRS.creature.content),
    ]);
    return { data, content };
  }

  /** A data-area picture beats a shipped one, so dropping `<id>.png` into the data root pictures any creature. */
  private static picturesOf(id: string, folders: Record<StorageArea, Map<string, Pictures>>): Pictures {
    const data = folders.data.get(id);
    const content = folders.content.get(id);
    return { image: data?.image ?? content?.image ?? null, token: data?.token ?? content?.token ?? null };
  }

  private async readCreature(area: StorageArea, id: string, pictures: Pictures): Promise<Creature> {
    const creature = await this.parseFile(area, libraryDocPath('creature', area, id), (t) => parseCreatureFile(t, id));
    return { ...creature, ...pictures };
  }

  /** Copies `wanted` to the creature's convention name unless it already is a picture of this creature. */
  private async storePicture(id: string, kind: PictureKind, wanted: AssetRef | null): Promise<AssetRef | null> {
    let stored = wanted;
    if (wanted) {
      const extension = extensionOf(wanted.path);
      if (!PICTURE_EXTENSIONS.includes(extension)) {
        throw new DataError('Creature pictures must be PNG, JPEG or WebP', wanted.area, wanted.path);
      }
      if (wanted.path !== creaturePictureRef(wanted.area, id, kind, extension).path) {
        stored = creaturePictureRef('data', id, kind, extension);
        await this.storage.copy(wanted.area, wanted.path, stored.path);
      }
    }
    return stored;
  }

  /**
   * Makes the picture files of `id` match `pictures`: a picture elsewhere is copied to `<id>[.token].<ext>` in
   * the data area, other extensions of that kind are removed, null removes the data-area picture.
   */
  async storeCreaturePictures(id: string, pictures: Pictures): Promise<Pictures> {
    const folder = await this.storage.list('data', LIBRARY_DIRS.creature.data);
    const existing = folder.filter((e) => !e.isDir && PICTURE_FILE.exec(e.name)?.[1] === id);
    const stored: Pictures = { image: null, token: null };
    for (const kind of ['image', 'token'] as const) {
      stored[kind] = await this.storePicture(id, kind, pictures[kind]);
      const keep = stored[kind]?.area === 'data' ? stored[kind].path : null;
      const stale = existing
        .filter((e) => (PICTURE_FILE.exec(e.name)![2] ? 'token' : 'image') === kind)
        .map((e) => `${LIBRARY_DIRS.creature.data}/${e.name}`)
        .filter((path) => path !== keep);
      await Promise.all(stale.map((path) => this.storage.remove(path)));
    }
    return stored;
  }

  /** Writes a picture file under the creature's convention name at once and drops other extensions. */
  async importCreaturePicture(id: string, kind: PictureKind, fileName: string, bytes: Uint8Array): Promise<AssetRef> {
    const extension = extensionOf(fileName);
    if (!PICTURE_EXTENSIONS.includes(extension)) {
      throw new DataError('Creature pictures must be PNG, JPEG or WebP', 'data', fileName);
    }
    const ref = creaturePictureRef('data', id, kind, extension);
    await this.storage.writeBytes(ref.path, bytes);
    const current = await this.storeCreaturePictures(id, { ...(await this.creaturePictures(id)), [kind]: ref });
    return current[kind]!;
  }

  private async creaturePictures(id: string): Promise<Pictures> {
    const folders = await this.creatureFolders();
    return Repository.picturesOf(id, {
      data: picturesIn('data', folders.data),
      content: picturesIn('content', folders.content),
    });
  }

  /** Writes the creature's text file and pictures as given (no time stamp). */
  async storeCreature(creature: Creature): Promise<Creature> {
    const parsed = creatureSchema.parse(creature);
    await this.storage.writeText(libraryDocPath('creature', 'data', parsed.id), formatCreatureFile(parsed));
    return { ...parsed, ...(await this.storeCreaturePictures(parsed.id, parsed)) };
  }

  private async listCreatures(listing: LibraryListing<'creature'>, data: LibraryListing<'creature'>) {
    const folders = await this.creatureFolders();
    const pictures = { data: picturesIn('data', folders.data), content: picturesIn('content', folders.content) };
    await Promise.all(
      (['content', 'data'] as const).map(async (area) => {
        const ids = folders[area].filter((e) => !e.isDir && e.name.endsWith('.txt')).map((e) => e.name.slice(0, -4));
        const target = area === 'data' ? data : listing;
        const results = await Promise.allSettled(
          ids.map((id) => this.readCreature(area, id, Repository.picturesOf(id, pictures))),
        );
        results.forEach((result, i) => {
          const ref = { area, id: ids[i]! };
          if (result.status === 'fulfilled') {
            target.entries.push({ ref, doc: result.value, overridesContent: false });
          } else {
            const path = libraryDocPath('creature', area, ref.id);
            target.problems.push({ area, path, message: errorMessage(result.reason) });
          }
        });
      }),
    );
  }

  // --- maps ---

  private async readMap(area: StorageArea, id: string): Promise<BattleMap> {
    const dir = mapDir(area, id);
    return this.parseFile(area, `${dir}/map.json`, async (text) => {
      const file = mapFileSchema.parse(migrate('map', JSON.parse(text)));
      const { heightmap, ...terrain } = file.terrain;
      const { cols, rows } = HeightField.dimensions(file.grid, terrain.samplesPerSquare);
      const png = await this.storage.readBytes(area, `${dir}/${heightmap.file}`);
      const heights = await decodeHeightmap(png, heightmap, cols, rows);
      return mapSchema.parse({ ...file, terrain: { ...terrain, heights: float32ToBase64(heights) } });
    });
  }

  /** The `map.json` text and `terrain.png` bytes of a map. */
  async mapFiles(map: BattleMap): Promise<{ json: string; terrain: Uint8Array }> {
    const parsed = mapSchema.parse(map);
    const field = HeightField.fromMap(parsed);
    const { png, scale } = await encodeHeightmap(field.data, field.cols, field.rows);
    const { heights: _inPng, ...terrain } = parsed.terrain;
    const file = mapFileSchema.parse({
      ...parsed,
      terrain: { ...terrain, heightmap: { file: TERRAIN_FILE, ...scale } },
    });
    return { json: `${JSON.stringify(file, null, 2)}\n`, terrain: png };
  }

  /** Writes the map folder's `terrain.png` and `map.json` as given (no time stamp). */
  async storeMap(map: BattleMap): Promise<BattleMap> {
    const { json, terrain } = await this.mapFiles(map);
    const dir = mapDir('data', map.id);
    await this.storage.writeBytes(`${dir}/${TERRAIN_FILE}`, terrain);
    await this.storage.writeText(`${dir}/map.json`, json);
    return mapSchema.parse(map);
  }

  /** Grid of the map an encounter uses: a user copy of a shipped map wins like in play. */
  private async mapGrid(ref: DocRef) {
    const edited = ref.area === 'content' && (await this.storage.exists('data', libraryDocPath('map', 'data', ref.id)));
    const area = edited ? 'data' : ref.area;
    const path = libraryDocPath('map', area, ref.id);
    const found = edited || (await this.storage.exists(area, path));
    const grid = (text: string) => z.object({ grid: gridSchema }).parse(JSON.parse(text)).grid;
    return found ? this.parseFile(area, path, grid) : null;
  }

  // --- library ---

  load<K extends LibraryKind>(kind: K, ref: DocRef): Promise<LibraryDocs[K]>;
  async load(kind: LibraryKind, ref: DocRef): Promise<LibraryDocs[LibraryKind]> {
    const loaders: Record<LibraryKind, () => Promise<LibraryDocs[LibraryKind]>> = {
      creature: async () => this.readCreature(ref.area, ref.id, await this.creaturePictures(ref.id)),
      marker: () => this.readJson('marker', markerTemplateSchema, ref.area, libraryDocPath('marker', ref.area, ref.id)),
      map: () => this.readMap(ref.area, ref.id),
    };
    return loaders[kind]();
  }

  private async listArea<K extends LibraryKind>(kind: K, area: StorageArea, listing: LibraryListing<K>) {
    const dir = LIBRARY_DIRS[kind][area];
    const ids = (await this.storage.list(area, dir))
      .filter((e) => (kind === 'map' ? e.isDir : !e.isDir && e.name.endsWith('.json')))
      .map((e) => (kind === 'map' ? e.name : e.name.slice(0, -'.json'.length)));
    const results = await Promise.allSettled(ids.map((id) => this.load(kind, { area, id })));
    results.forEach((result, i) => {
      const id = ids[i]!;
      if (result.status === 'fulfilled') {
        listing.entries.push({ ref: { area, id }, doc: result.value, overridesContent: false });
      } else {
        listing.problems.push({ area, path: libraryDocPath(kind, area, id), message: errorMessage(result.reason) });
      }
    });
  }

  /** Shipped and user documents; a user document with the same id replaces the shipped one. */
  async list<K extends LibraryKind>(kind: K): Promise<LibraryListing<K>> {
    const content: LibraryListing<K> = { entries: [], problems: [] };
    const data: LibraryListing<K> = { entries: [], problems: [] };
    if (kind === 'creature') {
      await this.listCreatures(content as LibraryListing<'creature'>, data as LibraryListing<'creature'>);
    } else {
      await Promise.all([this.listArea(kind, 'content', content), this.listArea(kind, 'data', data)]);
    }
    const userIds = new Set(data.entries.map((e) => e.ref.id));
    const entries = [
      ...content.entries.filter((e) => !userIds.has(e.ref.id)),
      ...data.entries.map((e) => ({ ...e, overridesContent: content.entries.some((c) => c.ref.id === e.ref.id) })),
    ].sort((a, b) => a.doc.name.localeCompare(b.doc.name));
    const dir = `${LIBRARY_DIRS[kind].data}/`;
    const problems = this.withLayoutProblems([...content.problems, ...data.problems], (p) => p.startsWith(dir));
    return { entries, problems };
  }

  /** Always writes to the data area; saving a shipped document creates the user override. */
  save<K extends LibraryKind>(kind: K, doc: LibraryDocs[K]): Promise<LibraryDocs[K]>;
  async save(kind: LibraryKind, doc: LibraryDocs[LibraryKind]): Promise<LibraryDocs[LibraryKind]> {
    const stamped = { ...doc, updatedAt: nowIso() };
    const savers: Record<LibraryKind, () => Promise<LibraryDocs[LibraryKind]>> = {
      creature: () => this.storeCreature(stamped as Creature),
      marker: async () => {
        const marker = markerTemplateSchema.parse(stamped);
        await this.writeJson(libraryDocPath('marker', 'data', marker.id), marker);
        return marker;
      },
      map: () => this.storeMap(stamped as BattleMap),
    };
    return savers[kind]();
  }

  /**
   * Deletes the user document. A creature's pictures go with it unless a shipped creature with that id
   * remains, whose pictures they then are.
   */
  async remove(kind: LibraryKind, id: string): Promise<void> {
    const path = kind === 'map' ? mapDir('data', id) : libraryDocPath(kind, 'data', id);
    await this.storage.remove(path);
    const shipped = kind === 'creature' && (await this.storage.exists('content', libraryDocPath(kind, 'content', id)));
    if (kind === 'creature' && !shipped) {
      await this.storeCreaturePictures(id, { image: null, token: null });
    }
  }

  async importMapAsset(mapId: string, fileName: string, bytes: Uint8Array): Promise<AssetRef> {
    const safeName = fileName.replace(/[^\w.\- ]+/g, '_');
    const ref = mapAssetRef(mapId, safeName);
    await this.storage.writeBytes(ref.path, bytes);
    return ref;
  }

  /** Copies a map and the assets in its folder; the copy no longer depends on the source map. */
  async duplicateMap(ref: DocRef, name: string): Promise<BattleMap> {
    const source = await this.load('map', ref);
    const id = newId();
    const fromDir = `${mapDir(ref.area, ref.id)}/assets`;
    const toDir = `${mapDir('data', id)}/assets`;
    if ((await this.storage.list(ref.area, fromDir)).length > 0) {
      await this.storage.copy(ref.area, fromDir, toDir);
    }
    const remap = (asset: AssetRef): AssetRef =>
      asset.area === ref.area && asset.path.startsWith(`${fromDir}/`)
        ? { area: 'data', path: toDir + asset.path.slice(fromDir.length) }
        : asset;
    const at = nowIso();
    return this.save('map', {
      ...source,
      id,
      name,
      createdAt: at,
      updatedAt: at,
      image: source.image && { ...source.image, asset: remap(source.image.asset) },
      props: source.props.map((p) => ({ ...p, asset: remap(p.asset) })),
    });
  }

  // --- campaigns ---

  private async readCampaign(id: string): Promise<Campaign> {
    const file = await this.parseFile('data', campaignPath(id), (text) =>
      campaignFileSchema.parse(migrate('campaign', JSON.parse(text))),
    );
    const notesPath = campaignNotesPath(id);
    const notes = (await this.storage.exists('data', notesPath)) ? await this.storage.readText('data', notesPath) : '';
    return campaignSchema.parse({ ...file, notes });
  }

  async listCampaigns(): Promise<{ campaigns: Campaign[]; problems: LoadProblem[] }> {
    const dirs = (await this.storage.list('data', 'campaigns')).filter((e) => e.isDir).map((e) => e.name);
    const results = await Promise.allSettled(dirs.map((id) => this.readCampaign(id)));
    const campaigns: Campaign[] = [];
    const problems: LoadProblem[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        campaigns.push(result.value);
      } else {
        problems.push({ area: 'data', path: campaignPath(dirs[i]!), message: errorMessage(result.reason) });
      }
    });
    const ownFiles = (path: string) => /^campaigns\/[^/]+\/[^/]+$/.test(path);
    const sorted = campaigns.sort((a, b) => a.name.localeCompare(b.name));
    return { campaigns: sorted, problems: this.withLayoutProblems(problems, ownFiles) };
  }

  /** Writes `campaign.json` and `notes.md` as given (no time stamp). */
  async storeCampaign(campaign: Campaign): Promise<Campaign> {
    const parsed = campaignSchema.parse(campaign);
    await this.storage.writeText(campaignNotesPath(parsed.id), parsed.notes);
    await this.writeJson(campaignPath(parsed.id), campaignFileSchema.parse(parsed));
    return parsed;
  }

  saveCampaign(campaign: Campaign): Promise<Campaign> {
    return this.storeCampaign({ ...campaign, updatedAt: nowIso() });
  }

  // --- encounters ---

  /** Fog grid of the encounter's map; null without a map, whose fog cannot be stored. */
  async encounterFogSize(encounter: Pick<EncounterFile, 'map' | 'fog'>): Promise<FogSize | null> {
    const grid = encounter.map && (await this.mapGrid(encounter.map));
    return grid ? fogSize(grid, encounter.fog.cellsPerSquare) : null;
  }

  async listEncounters(campaignId: string): Promise<{ encounters: Encounter[]; problems: LoadProblem[] }> {
    const dir = `campaigns/${campaignId}/encounters`;
    const ids = (await this.storage.list('data', dir)).filter((e) => e.isDir).map((e) => e.name);
    const results = await Promise.allSettled(ids.map((id) => this.loadEncounter(campaignId, id)));
    const encounters: Encounter[] = [];
    const problems: LoadProblem[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        encounters.push(result.value);
      } else {
        const path = encounterPath(campaignId, ids[i]!);
        problems.push({ area: 'data', path, message: errorMessage(result.reason) });
      }
    });
    const sorted = encounters.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { encounters: sorted, problems: this.withLayoutProblems(problems, (p) => p.startsWith(`${dir}/`)) };
  }

  /** One fog mask as a bitset, empty when it is missing or no longer fits the (resized) map. */
  private async readFogMask(path: string, size: FogSize | null): Promise<string> {
    const png = size && (await this.storage.exists('data', path)) && (await this.storage.readBytes('data', path));
    const shape = png ? readPngSize(png) : null;
    const fits = png && size && shape!.width === size.cellsX && shape!.height === size.cellsY;
    return fits ? (await decodeFogMask(png, size)).toBase64() : '';
  }

  loadEncounter(campaignId: string, id: string): Promise<Encounter> {
    const dir = encounterDir(campaignId, id);
    return this.parseFile('data', encounterPath(campaignId, id), async (text) => {
      const file = encounterFileSchema.parse(migrate('encounter', JSON.parse(text)));
      const size = await this.encounterFogSize(file);
      const explored = (await this.storage.list('data', `${dir}/fog/explored`))
        .filter((e) => !e.isDir && e.name.endsWith('.png'))
        .map((e) => e.name.slice(0, -'.png'.length));
      const paths = fogMaskPaths(dir, { exploredBy: Object.fromEntries(explored.map((c) => [c, ''])) });
      const exploredBy = Object.fromEntries(
        await Promise.all(explored.map(async (c) => [c, await this.readFogMask(paths.explored[c]!, size)] as const)),
      );
      const revealedByDm = await this.readFogMask(paths.revealed, size);
      const hiddenByDm = await this.readFogMask(paths.hidden, size);
      const fog = { ...file.fog, exploredBy, revealedByDm, hiddenByDm };
      return encounterSchema.parse({ ...file, fog: storableFog(fog, size) });
    });
  }

  /** Writes `encounter.json` and its fog masks as given (no time stamp); stale masks are removed. */
  async storeEncounter(encounter: Encounter): Promise<Encounter> {
    const parsed = encounterSchema.parse(encounter);
    const dir = encounterDir(parsed.campaignId, parsed.id);
    const size = await this.encounterFogSize(parsed);
    const fog = storableFog(parsed.fog, size);
    const paths = fogMaskPaths(dir, fog);
    const masks: [string, string][] = [
      ...Object.entries(fog.exploredBy).map(([id, bits]): [string, string] => [paths.explored[id]!, bits]),
      [paths.revealed, fog.revealedByDm],
      [paths.hidden, fog.hiddenByDm],
    ];
    const written = masks.filter(([, bits]) => bits !== '');
    const count = size ? size.cellsX * size.cellsY : 0;
    await Promise.all(
      written.map(async ([path, bits]) =>
        this.storage.writeBytes(path, await encodeFogMask(readFogBits(bits, count), size!)),
      ),
    );
    const kept = new Set(written.map(([path]) => path));
    const present = [
      ...(await this.storage.list('data', `${dir}/fog/explored`)).map((e) => `${dir}/fog/explored/${e.name}`),
      ...(await this.storage.list('data', `${dir}/fog`)).filter((e) => !e.isDir).map((e) => `${dir}/fog/${e.name}`),
    ];
    await Promise.all(present.filter((path) => !kept.has(path)).map((path) => this.storage.remove(path)));
    await this.writeJson(encounterPath(parsed.campaignId, parsed.id), encounterFileSchema.parse(parsed));
    return { ...parsed, fog };
  }

  saveEncounter(encounter: Encounter): Promise<Encounter> {
    return this.storeEncounter({ ...encounter, updatedAt: nowIso() });
  }

  removeEncounter(campaignId: string, id: string): Promise<void> {
    return this.storage.remove(encounterDir(campaignId, id));
  }

  // --- settings ---

  async loadSettings(): Promise<Settings> {
    const exists = await this.storage.exists('data', SETTINGS_PATH);
    return exists ? this.readJson('settings', settingsSchema, 'data', SETTINGS_PATH) : defaultSettings();
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    const parsed = settingsSchema.parse(settings);
    await this.writeJson(SETTINGS_PATH, parsed);
    return parsed;
  }
}
