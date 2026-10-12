import { z } from 'zod';
import { base64ToBytes, float32ToBase64 } from '@/core/binary';
import { formatCreatureFile, parseCreatureFile } from '@/core/import/creatureFile';
import { freeDocumentId } from '@/core/import/ids';
import {
  campaignFileSchema,
  campaignSchema,
  creatureSchema,
  defaultPackSettings,
  defaultSettings,
  encounterFileSchema,
  encounterSchema,
  gridSchema,
  mapFileSchema,
  mapSchema,
  markerTemplateSchema,
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
  type PackSettings,
  type Settings,
  type StorageArea,
} from '@/core/model';
import { formatItemFile, parseItemFile, type Item } from '@/core/items';
import { readPngSize } from '@/core/png';
import { formatSpellFile, parseSpellFile, type Spell } from '@/core/spells';
import { formatTableFile, parseTableFile, type RandomTable } from '@/core/tables';
import { HeightField } from '@/core/terrain/heightfield';
import { decodeHeightmap, encodeHeightmap } from '@/core/terrain/heightmap';
import { fogSize, readFogBits, type FogSize } from '@/core/vision/fog';
import { decodeFogMask, encodeFogMask } from '@/core/vision/fogMask';
import { migrate } from './migrations';
import {
  formatPackManifest,
  isPackEnabled,
  MY_CONTENT,
  MY_CONTENT_SOURCE,
  orderPacks,
  PACK_FILE,
  PACK_ID,
  packManifestSchema,
  PACKS_DIR,
  packSource,
  writableSource,
  type InstalledPack,
  type LibrarySource,
  type PackManifest,
} from './packs';
import type { DirEntry, Storage } from './storage';

export type LibraryKind = 'creature' | 'marker' | 'map' | 'table' | 'item' | 'spell';
export const LIBRARY_KINDS: LibraryKind[] = ['creature', 'marker', 'map', 'table', 'item', 'spell'];

export interface LibraryDocs {
  creature: Creature;
  marker: MarkerTemplate;
  map: BattleMap;
  table: RandomTable;
  item: Item;
  spell: Spell;
}

interface KindLayout {
  /** Folder of the kind inside a pack root. */
  dir: string;
  /** What follows the id in the document's path; maps are folders holding `map.json`. */
  file: string;
  folder: boolean;
  /** Id of a new document whose name has no letters or digits. */
  fallbackId: string;
}

export const KIND_LAYOUTS: Record<LibraryKind, KindLayout> = {
  creature: { dir: 'creatures', file: '.txt', folder: false, fallbackId: 'creature' },
  marker: { dir: 'markers', file: '.json', folder: false, fallbackId: 'area' },
  map: { dir: 'maps', file: '/map.json', folder: true, fallbackId: 'map' },
  table: { dir: 'tables', file: '.txt', folder: false, fallbackId: 'table' },
  item: { dir: 'items', file: '.md', folder: false, fallbackId: 'item' },
  spell: { dir: 'spells', file: '.md', folder: false, fallbackId: 'spell' },
};

/** Reads and writes one kind; `reader` gets the kind folder listings of `sources` in the same order. */
interface KindCodec<K extends LibraryKind> {
  reader(
    sources: LibrarySource[],
    folders: DirEntry[][],
  ): (source: LibrarySource, id: string) => Promise<LibraryDocs[K]>;
  write(target: LibrarySource, doc: LibraryDocs[K]): Promise<LibraryDocs[K]>;
}

const SETTINGS_PATH = 'settings.json';
const TERRAIN_FILE = 'terrain.png';
const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
/** `<id>.<ext>` is a creature's image, `<id>.token.<ext>` its token picture. */
const PICTURE_FILE = /^(.+?)(\.token)?\.(png|jpe?g|webp)$/i;
/** A file in the creature folder of My content or a pack. */
const CREATURE_FOLDER_FILE = /^(?:library|packs\/[a-z0-9-]+)\/creatures\/[^/]+$/;
const MODEL_FILE = /\.(glb|gltf)$/i;
/** Picture library folder of a pack root (Aurora Builder portraits and the like). */
export const PORTRAITS_DIR = 'portraits';

/** A picture in a `portraits/` folder of My content or a pack. */
export interface PortraitEntry {
  pack: string;
  /** File name, e.g. `elf female druid.jpg`. */
  name: string;
  ref: AssetRef;
}

export type PictureKind = 'image' | 'token';
type Pictures = Pick<Creature, PictureKind>;

export interface LibraryEntry<K extends LibraryKind> {
  ref: DocRef;
  doc: LibraryDocs[K];
  /** Pack the document comes from (`MY_CONTENT` for the user's own). */
  pack: string;
  /** Enabled packs holding a document with the same id that this one hides, highest precedence first. */
  overrides: string[];
}

export interface LoadProblem {
  area: StorageArea;
  path: string;
  message: string;
}

export interface LibraryListing<K extends LibraryKind> {
  entries: LibraryEntry<K>[];
  problems: LoadProblem[];
  /** Documents of enabled packs hidden by one with the same id from pack `by`. */
  shadowed: { id: string; pack: string; by: string }[];
  /** Documents only disabled packs hold, by the first such pack; encounters may still refer to them. */
  unavailable: { id: string; pack: string }[];
}

export interface PackInfo extends InstalledPack {
  manifest: PackManifest;
  enabled: boolean;
  /** Documents per library kind plus 3D models (`.glb`/`.gltf` under `models/`) and pictures in `portraits/`. */
  counts: Record<LibraryKind | 'model' | 'portrait', number>;
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

export function libraryDir(kind: LibraryKind, source: LibrarySource): string {
  return `${source.root}/${KIND_LAYOUTS[kind].dir}`;
}

/** Maps are folders so their images, models and heightmap travel with them; creatures are stat block text. */
export function libraryDocPath(kind: LibraryKind, source: LibrarySource, id: string): string {
  return `${libraryDir(kind, source)}/${id}${KIND_LAYOUTS[kind].file}`;
}

/** Ids of the documents in a kind folder listing; pictures and other files are skipped. */
function docIds(kind: LibraryKind, entries: DirEntry[]): string[] {
  const { file, folder } = KIND_LAYOUTS[kind];
  return entries
    .filter((e) => (folder ? e.isDir : !e.isDir && e.name.endsWith(file)))
    .map((e) => (folder ? e.name : e.name.slice(0, -file.length)));
}

function mapDir(source: LibrarySource, id: string): string {
  return `${libraryDir('map', source)}/${id}`;
}

/** Where an asset file of map `mapId` in `pack` (My content by default) is stored. */
export function mapAssetRef(mapId: string, fileName: string, pack = MY_CONTENT): AssetRef {
  return { area: 'data', path: `${mapDir(writableSource(pack), mapId)}/assets/${fileName}` };
}

/** Where a creature's picture of `kind` with the file extension `extension` lives by name convention. */
export function creaturePictureRef(source: LibrarySource, id: string, kind: PictureKind, extension: string): AssetRef {
  const suffix = kind === 'token' ? '.token' : '';
  return { area: source.area, path: `${libraryDir('creature', source)}/${id}${suffix}.${extension.toLowerCase()}` };
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

/** Ids used in a folder, lower-cased: Windows file names ignore case. Pictures count, so none goes astray. */
function takenIds(entries: DirEntry[]): Set<string> {
  return new Set(entries.map((e) => e.name.split('.')[0]!.toLowerCase()));
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
function picturesIn(source: LibrarySource, entries: DirEntry[]): Map<string, Pictures> {
  const pictures = new Map<string, Pictures>();
  for (const entry of entries.filter((e) => !e.isDir)) {
    const match = PICTURE_FILE.exec(entry.name);
    if (match) {
      const id = match[1]!;
      const kind: PictureKind = match[2] ? 'token' : 'image';
      const found = pictures.get(id) ?? { image: null, token: null };
      // Sorted listings make the first extension win when several exist.
      pictures.set(id, { ...found, [kind]: found[kind] ?? creaturePictureRef(source, id, kind, match[3]!) });
    }
  }
  return pictures;
}

/** Pictures by precedence: a picture in My content beats a pack's, so `<id>.png` there pictures any creature. */
function picturesOf(id: string, bySource: Map<string, Pictures>[]): Pictures {
  const found = bySource.map((pictures) => pictures.get(id));
  return {
    image: found.find((p) => p?.image)?.image ?? null,
    token: found.find((p) => p?.token)?.token ?? null,
  };
}

const MY_CONTENT_MANIFEST: PackManifest = {
  id: MY_CONTENT,
  name: 'My content',
  version: '',
  author: '',
  license: '',
  description: 'Your own creatures, maps and templates. Always on; wins over every pack.',
  url: '',
};

export class Repository {
  /**
   * Documents the one-time layout migration (`migrateDataRoot`) could not convert; their old files stay
   * untouched and the listings report them.
   */
  layoutProblems: LoadProblem[] = [];
  /** Pack order and enabled state; follows the settings this repository loads and saves. */
  packSettings: PackSettings = defaultPackSettings();

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

  private readJson<T>(schemaName: 'settings', schema: z.ZodType<T>, area: StorageArea, path: string) {
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

  // --- packs ---

  /**
   * My content, then every installed pack (a folder under `packs/` with a `pack.json`) by precedence. A user
   * pack with the id of a shipped one is left out; `listPacks` reports it.
   */
  async installedPacks(): Promise<(InstalledPack & { enabled: boolean })[]> {
    const found = async (area: StorageArea) => {
      const dirs = (await this.storage.list(area, PACKS_DIR)).filter((e) => e.isDir && PACK_ID.test(e.name));
      const manifests = await Promise.all(
        dirs.map((e) => this.storage.exists(area, `${PACKS_DIR}/${e.name}/${PACK_FILE}`)),
      );
      return dirs.filter((_e, i) => manifests[i]).map((e) => packSource(area, e.name));
    };
    const [shipped, user] = await Promise.all([found('content'), found('data')]);
    const shippedIds = new Set(shipped.map((s) => s.pack));
    const packs: InstalledPack[] = [
      ...shipped.map((source) => ({ source, origin: 'shipped' as const })),
      ...user
        .filter((s) => !shippedIds.has(s.pack) && s.pack !== MY_CONTENT)
        .map((source) => ({ source, origin: 'user' as const })),
    ];
    const ordered = [{ source: MY_CONTENT_SOURCE, origin: 'mine' as const }, ...orderPacks(packs, this.packSettings)];
    return ordered.map((p) => ({ ...p, enabled: isPackEnabled(p.source.pack, this.packSettings) }));
  }

  /** Where library documents come from, highest precedence first: My content and the enabled packs. */
  async librarySources(): Promise<LibrarySource[]> {
    return (await this.installedPacks()).filter((p) => p.enabled).map((p) => p.source);
  }

  /** Every file below `dir`, as paths relative to the area root, sorted. */
  async listFiles(area: StorageArea, dir: string): Promise<string[]> {
    const entries = await this.storage.list(area, dir);
    const nested = await Promise.all(
      entries.map((e) => (e.isDir ? this.listFiles(area, `${dir}/${e.name}`) : Promise.resolve([`${dir}/${e.name}`]))),
    );
    return nested.flat();
  }

  private async readManifest(pack: InstalledPack, problems: LoadProblem[]): Promise<PackManifest> {
    const { source } = pack;
    const path = `${source.root}/${PACK_FILE}`;
    let manifest = MY_CONTENT_MANIFEST;
    if (pack.origin !== 'mine') {
      try {
        manifest = await this.parseFile(source.area, path, (t) => packManifestSchema.parse(JSON.parse(t)));
      } catch (error) {
        problems.push({ area: source.area, path, message: errorMessage(error) });
        // The pack's documents still load; the list shows it by folder name.
        manifest = packManifestSchema.parse({ id: source.pack, name: source.pack });
      }
    }
    return manifest;
  }

  /** Installed packs with manifest, enabled state and document counts, in precedence order. */
  async listPacks(): Promise<{ packs: PackInfo[]; problems: LoadProblem[] }> {
    const problems: LoadProblem[] = [];
    const installed = await this.installedPacks();
    const userDirs = (await this.storage.list('data', PACKS_DIR)).filter((e) => e.isDir).map((e) => e.name);
    for (const id of userDirs.filter((d) => !installed.some((p) => p.origin === 'user' && p.source.pack === d))) {
      const reason = PACK_ID.test(id) ? 'has no pack.json or the id of a built-in pack' : 'is no valid pack id';
      const path = `${PACKS_DIR}/${id}`;
      problems.push({ area: 'data', path, message: `Pack folder "${id}" ${reason}; it is not used` });
    }
    const packs = await Promise.all(
      installed.map(async (pack): Promise<PackInfo> => {
        const { source } = pack;
        const lists = await this.kindFoldersOf(source);
        const models = (await this.listFiles(source.area, `${source.root}/models`)).filter((f) => MODEL_FILE.test(f));
        const portraits = await this.storage.list(source.area, `${source.root}/${PORTRAITS_DIR}`);
        const portrait = portraits.filter((e) => !e.isDir && PICTURE_FILE.test(e.name)).length;
        const counts = { creature: 0, marker: 0, map: 0, table: 0, item: 0, spell: 0, model: models.length, portrait };
        LIBRARY_KINDS.forEach((kind, i) => {
          counts[kind] = docIds(kind, lists[i]!).length;
        });
        return { ...pack, manifest: await this.readManifest(pack, problems), counts };
      }),
    );
    return { packs, problems };
  }

  private kindFoldersOf(source: LibrarySource): Promise<DirEntry[][]> {
    return Promise.all(LIBRARY_KINDS.map((kind) => this.storage.list(source.area, libraryDir(kind, source))));
  }

  /** Creates the user pack of `manifest` unless it exists; documents then go in with `save(kind, doc, id)`. */
  async ensurePack(manifest: PackManifest): Promise<void> {
    const parsed = packManifestSchema.parse(manifest);
    const path = `${PACKS_DIR}/${parsed.id}/${PACK_FILE}`;
    if (parsed.id === MY_CONTENT || (await this.storage.exists('content', path))) {
      throw new DataError(`"${parsed.id}" is the id of a built-in pack`, 'data', path);
    }
    if (!(await this.storage.exists('data', path))) {
      await this.storage.writeText(path, formatPackManifest(parsed));
    }
  }

  /** Pictures in the `portraits/` folders of My content and the enabled packs, by precedence, then name. */
  async listPortraits(): Promise<PortraitEntry[]> {
    const sources = await this.librarySources();
    const folders = await Promise.all(sources.map((s) => this.storage.list(s.area, `${s.root}/${PORTRAITS_DIR}`)));
    return sources.flatMap((source, i) =>
      folders[i]!.filter((e) => !e.isDir && PICTURE_FILE.test(e.name))
        .map((e) => ({
          pack: source.pack,
          name: e.name,
          ref: { area: source.area, path: `${source.root}/${PORTRAITS_DIR}/${e.name}` },
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  // --- creatures ---

  private async readCreature(source: LibrarySource, id: string, pictures: Pictures): Promise<Creature> {
    const path = libraryDocPath('creature', source, id);
    const creature = await this.parseFile(source.area, path, (t) => parseCreatureFile(t, id));
    return { ...creature, ...pictures };
  }

  /** Copies `wanted` into `target` unless it already is this creature's picture in some pack's folder. */
  private async storePicture(
    target: LibrarySource,
    id: string,
    kind: PictureKind,
    wanted: AssetRef | null,
  ): Promise<AssetRef | null> {
    let stored = wanted;
    if (wanted) {
      const extension = extensionOf(wanted.path);
      if (!PICTURE_EXTENSIONS.includes(extension)) {
        throw new DataError('Creature pictures must be PNG, JPEG or WebP', wanted.area, wanted.path);
      }
      const convention = creaturePictureRef(target, id, kind, extension);
      const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
      const isOwn = CREATURE_FOLDER_FILE.test(wanted.path) && fileName(wanted.path) === fileName(convention.path);
      if (!isOwn) {
        stored = convention;
        await this.storage.copy(wanted.area, wanted.path, stored.path);
      }
    }
    return stored;
  }

  /**
   * Makes the picture files of `id` in `pack` (My content by default) match `pictures`: a picture elsewhere is
   * copied to `<id>[.token].<ext>` there, other extensions of that kind are removed, null removes the pack's
   * picture.
   */
  async storeCreaturePictures(id: string, pictures: Pictures, pack = MY_CONTENT): Promise<Pictures> {
    const target = writableSource(pack);
    const dir = libraryDir('creature', target);
    const folder = await this.storage.list('data', dir);
    const existing = folder.filter((e) => !e.isDir && PICTURE_FILE.exec(e.name)?.[1] === id);
    const stored: Pictures = { image: null, token: null };
    for (const kind of ['image', 'token'] as const) {
      stored[kind] = await this.storePicture(target, id, kind, pictures[kind]);
      const keep = stored[kind]?.area === 'data' ? stored[kind].path : null;
      const stale = existing
        .filter((e) => (PICTURE_FILE.exec(e.name)![2] ? 'token' : 'image') === kind)
        .map((e) => `${dir}/${e.name}`)
        .filter((path) => path !== keep);
      await Promise.all(stale.map((path) => this.storage.remove(path)));
    }
    return stored;
  }

  /** Writes a picture file under the creature's convention name at once and drops other extensions. */
  async importCreaturePicture(
    id: string,
    kind: PictureKind,
    fileName: string,
    bytes: Uint8Array,
    pack = MY_CONTENT,
  ): Promise<AssetRef> {
    const extension = extensionOf(fileName);
    if (!PICTURE_EXTENSIONS.includes(extension)) {
      throw new DataError('Creature pictures must be PNG, JPEG or WebP', 'data', fileName);
    }
    const ref = creaturePictureRef(writableSource(pack), id, kind, extension);
    await this.storage.writeBytes(ref.path, bytes);
    const current = await this.storeCreaturePictures(id, { ...(await this.creaturePictures(id)), [kind]: ref }, pack);
    return current[kind]!;
  }

  private async creaturePictures(id: string): Promise<Pictures> {
    const sources = await this.librarySources();
    const folders = await this.kindFolders('creature', sources);
    return picturesOf(
      id,
      sources.map((s, i) => picturesIn(s, folders[i]!)),
    );
  }

  /** Writes the creature's text file and pictures into `pack` as given (no time stamp). */
  async storeCreature(creature: Creature, pack = MY_CONTENT): Promise<Creature> {
    const parsed = creatureSchema.parse(creature);
    await this.storage.writeText(
      libraryDocPath('creature', writableSource(pack), parsed.id),
      formatCreatureFile(parsed),
    );
    return { ...parsed, ...(await this.storeCreaturePictures(parsed.id, parsed, pack)) };
  }

  // --- maps ---

  private async readMap(source: LibrarySource, id: string): Promise<BattleMap> {
    const dir = mapDir(source, id);
    return this.parseFile(source.area, `${dir}/map.json`, async (text) => {
      const file = mapFileSchema.parse(migrate('map', JSON.parse(text)));
      const { heightmap, ...terrain } = file.terrain;
      const { cols, rows } = HeightField.dimensions(file.grid, terrain.samplesPerSquare);
      const png = await this.storage.readBytes(source.area, `${dir}/${heightmap.file}`);
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

  /** Writes the map folder's `terrain.png` and `map.json` into `pack` as given (no time stamp). */
  async storeMap(map: BattleMap, pack = MY_CONTENT): Promise<BattleMap> {
    const { json, terrain } = await this.mapFiles(map);
    const dir = mapDir(writableSource(pack), map.id);
    await this.storage.writeBytes(`${dir}/${TERRAIN_FILE}`, terrain);
    await this.storage.writeText(`${dir}/map.json`, json);
    return mapSchema.parse(map);
  }

  /**
   * Grid of the map an encounter uses, by precedence like in play. Disabled packs count too: their maps
   * still decide the fog grid, so disabling a pack never drops an encounter's fog.
   */
  private async mapGrid(ref: DocRef) {
    const sources = (await this.installedPacks()).map((p) => p.source);
    const folders = await this.kindFolders('map', sources);
    const source = sources[folders.findIndex((entries) => docIds('map', entries).includes(ref.id))];
    const grid = (text: string) => z.object({ grid: gridSchema }).parse(JSON.parse(text)).grid;
    return source ? this.parseFile(source.area, libraryDocPath('map', source, ref.id), grid) : null;
  }

  // --- library ---

  /** Codec of a kind stored as one text file per document. */
  private textCodec<K extends LibraryKind>(
    kind: K,
    parse: (text: string, id: string) => LibraryDocs[K],
    format: (doc: LibraryDocs[K]) => string,
  ): KindCodec<K> {
    return {
      reader: () => (source, id) =>
        this.parseFile(source.area, libraryDocPath(kind, source, id), (text) => parse(text, id)),
      write: async (target, doc) => {
        const text = format(doc);
        await this.storage.writeText(libraryDocPath(kind, target, doc.id), text);
        return parse(text, doc.id);
      },
    };
  }

  /** One codec per kind; a new kind adds its `LibraryKind`, `LibraryDocs` entry, layout and codec. */
  private readonly codecs: { [K in LibraryKind]: KindCodec<K> } = {
    creature: {
      reader: (sources, folders) => {
        const pictures = sources.map((s, i) => picturesIn(s, folders[i]!));
        return (source, id) => this.readCreature(source, id, picturesOf(id, pictures));
      },
      write: (target, doc) => this.storeCreature(doc, target.pack),
    },
    marker: this.textCodec(
      'marker',
      (text) => markerTemplateSchema.parse(migrate('marker', JSON.parse(text))),
      (doc) => `${JSON.stringify(markerTemplateSchema.parse(doc), null, 2)}\n`,
    ),
    map: {
      reader: () => (source, id) => this.readMap(source, id),
      write: (target, doc) => this.storeMap(doc, target.pack),
    },
    table: this.textCodec('table', parseTableFile, formatTableFile),
    item: this.textCodec('item', parseItemFile, formatItemFile),
    spell: this.textCodec('spell', parseSpellFile, formatSpellFile),
  };

  private kindFolders(kind: LibraryKind, sources: LibrarySource[]): Promise<DirEntry[][]> {
    return Promise.all(sources.map((s) => this.storage.list(s.area, libraryDir(kind, s))));
  }

  /** Why `id` cannot be loaded: it is only in a disabled pack, or nowhere. */
  private async missing(kind: LibraryKind, id: string): Promise<DataError> {
    const disabled = (await this.installedPacks()).filter((p) => !p.enabled).map((p) => p.source);
    const folders = await this.kindFolders(kind, disabled);
    const holder = disabled[folders.findIndex((entries) => docIds(kind, entries).includes(id))];
    const message = holder
      ? `"${id}" is in the disabled pack "${holder.pack}"; enable it under Compendium > Packs`
      : `No ${kind} "${id}" in My content or an enabled pack`;
    const source = holder ?? MY_CONTENT_SOURCE;
    return new DataError(message, source.area, libraryDocPath(kind, source, id));
  }

  /** Pack that provides document `id` now (first by precedence), null when no enabled source has it. */
  async sourceOf(kind: LibraryKind, id: string): Promise<LibrarySource | null> {
    const sources = await this.librarySources();
    const folders = await this.kindFolders(kind, sources);
    return sources[folders.findIndex((entries) => docIds(kind, entries).includes(id))] ?? null;
  }

  /**
   * The document with `ref.id` from the first source holding it: My content, then the enabled packs in
   * order. `ref.area` only records where it was when referenced.
   */
  load<K extends LibraryKind>(kind: K, ref: DocRef): Promise<LibraryDocs[K]>;
  async load(kind: LibraryKind, ref: DocRef): Promise<LibraryDocs[LibraryKind]> {
    const sources = await this.librarySources();
    const folders = await this.kindFolders(kind, sources);
    const index = folders.findIndex((entries) => docIds(kind, entries).includes(ref.id));
    if (index === -1) {
      throw await this.missing(kind, ref.id);
    }
    const codec = this.codecs[kind] as KindCodec<LibraryKind>;
    return codec.reader(sources, folders)(sources[index]!, ref.id);
  }

  /**
   * Documents of My content and the enabled packs; of several with the same id the one from the source of
   * highest precedence wins and the others are listed as shadowed.
   */
  async list<K extends LibraryKind>(kind: K): Promise<LibraryListing<K>> {
    const installed = await this.installedPacks();
    const sources = installed.filter((p) => p.enabled).map((p) => p.source);
    const disabled = installed.filter((p) => !p.enabled).map((p) => p.source);
    const [folders, disabledFolders] = await Promise.all([
      this.kindFolders(kind, sources),
      this.kindFolders(kind, disabled),
    ]);
    const winners = new Map<string, LibrarySource>();
    const listing: LibraryListing<K> = { entries: [], problems: [], shadowed: [], unavailable: [] };
    sources.forEach((source, i) => {
      for (const id of docIds(kind, folders[i]!)) {
        const by = winners.get(id);
        if (by) {
          listing.shadowed.push({ id, pack: source.pack, by: by.pack });
        } else {
          winners.set(id, source);
        }
      }
    });
    disabled.forEach((source, i) => {
      for (const id of docIds(kind, disabledFolders[i]!)) {
        if (!winners.has(id) && !listing.unavailable.some((u) => u.id === id)) {
          listing.unavailable.push({ id, pack: source.pack });
        }
      }
    });
    const read = (this.codecs[kind] as KindCodec<K>).reader(sources, folders);
    const ids = [...winners.keys()];
    const results = await Promise.allSettled(ids.map((id) => read(winners.get(id)!, id)));
    results.forEach((result, i) => {
      const id = ids[i]!;
      const source = winners.get(id)!;
      if (result.status === 'fulfilled') {
        const overrides = listing.shadowed.filter((s) => s.id === id).map((s) => s.pack);
        listing.entries.push({ ref: { area: source.area, id }, doc: result.value, pack: source.pack, overrides });
      } else {
        const path = libraryDocPath(kind, source, id);
        listing.problems.push({ area: source.area, path, message: errorMessage(result.reason) });
      }
    });
    listing.entries.sort((a, b) => a.doc.name.localeCompare(b.doc.name));
    const dir = `${libraryDir(kind, MY_CONTENT_SOURCE)}/`;
    listing.problems = this.withLayoutProblems(listing.problems, (p) => p.startsWith(dir));
    return listing;
  }

  /**
   * Writes into My content (or the imported pack `pack`) and stamps `updatedAt`; saving a pack's document in
   * My content creates the user copy that overrides it.
   */
  save<K extends LibraryKind>(kind: K, doc: LibraryDocs[K], pack?: string): Promise<LibraryDocs[K]>;
  async save(kind: LibraryKind, doc: LibraryDocs[LibraryKind], pack = MY_CONTENT): Promise<LibraryDocs[LibraryKind]> {
    const codec = this.codecs[kind] as KindCodec<LibraryKind>;
    return codec.write(writableSource(pack), { ...doc, updatedAt: nowIso() });
  }

  /**
   * Deletes the document from My content. A creature's pictures go with it unless a pack still holds a
   * creature with that id, whose pictures they then are.
   */
  async remove(kind: LibraryKind, id: string): Promise<void> {
    const path = kind === 'map' ? mapDir(MY_CONTENT_SOURCE, id) : libraryDocPath(kind, MY_CONTENT_SOURCE, id);
    await this.storage.remove(path);
    if (kind === 'creature') {
      const packs = (await this.installedPacks()).map((p) => p.source).filter((s) => s.pack !== MY_CONTENT);
      const folders = await this.kindFolders(kind, packs);
      if (!folders.some((entries) => docIds(kind, entries).includes(id))) {
        await this.storeCreaturePictures(id, { image: null, token: null });
      }
    }
  }

  async importMapAsset(mapId: string, fileName: string, bytes: Uint8Array, pack = MY_CONTENT): Promise<AssetRef> {
    const safeName = fileName.replace(/[^\w.\- ]+/g, '_');
    const ref = mapAssetRef(mapId, safeName, pack);
    await this.storage.writeBytes(ref.path, bytes);
    return ref;
  }

  /** Id for a new library document named `name`; ids in every installed pack count as taken. */
  async newLibraryId(kind: LibraryKind, name: string): Promise<string> {
    const sources = (await this.installedPacks()).map((p) => p.source);
    const folders = await this.kindFolders(kind, sources);
    return freeDocumentId(name, KIND_LAYOUTS[kind].fallbackId, takenIds(folders.flat()));
  }

  /** Copies a map and the assets in its folder into My content; the copy no longer depends on the source. */
  async duplicateMap(ref: DocRef, name: string): Promise<BattleMap> {
    const from = await this.sourceOf('map', ref.id);
    if (!from) {
      throw await this.missing('map', ref.id);
    }
    const source = await this.load('map', ref);
    const id = await this.newLibraryId('map', name);
    const fromDir = `${mapDir(from, ref.id)}/assets`;
    const toDir = `${mapDir(MY_CONTENT_SOURCE, id)}/assets`;
    if ((await this.storage.list(from.area, fromDir)).length > 0) {
      await this.storage.copy(from.area, fromDir, toDir);
    }
    const remap = (asset: AssetRef): AssetRef =>
      asset.area === from.area && asset.path.startsWith(`${fromDir}/`)
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

  async newCampaignId(name: string): Promise<string> {
    return freeDocumentId(name, 'campaign', takenIds(await this.storage.list('data', 'campaigns')));
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

  async newEncounterId(campaignId: string, name: string): Promise<string> {
    const entries = await this.storage.list('data', `campaigns/${campaignId}/encounters`);
    return freeDocumentId(name, 'encounter', takenIds(entries));
  }

  removeEncounter(campaignId: string, id: string): Promise<void> {
    return this.storage.remove(encounterDir(campaignId, id));
  }

  // --- settings ---

  /** Also makes the loaded pack order and enabled state the ones listings use. */
  async loadSettings(): Promise<Settings> {
    const exists = await this.storage.exists('data', SETTINGS_PATH);
    const settings = exists
      ? await this.readJson('settings', settingsSchema, 'data', SETTINGS_PATH)
      : defaultSettings();
    this.packSettings = settings.packs;
    return settings;
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    const parsed = settingsSchema.parse(settings);
    this.packSettings = parsed.packs;
    await this.writeJson(SETTINGS_PATH, parsed);
    return parsed;
  }
}
