import type { AssetRef } from '@/core/model';
import { readZip, writeZip, type ZipFile } from '@/core/zip';
import {
  formatPackManifest,
  MY_CONTENT,
  PACK_FILE,
  packManifestSchema,
  PACKS_DIR,
  remapJsonAssets,
  type LibrarySource,
  type PackManifest,
} from './packs';
import type { Repository } from './repository';

/** Files of a pack, paths relative to the pack folder, `pack.json` among them. */
export interface PackFiles {
  manifest: PackManifest;
  files: ZipFile[];
}

/** An imported pack with this id exists; importing again replaces it. */
export class PackExistsError extends Error {
  constructor(readonly manifest: PackManifest) {
    super(`A pack "${manifest.id}" is already installed`);
    this.name = 'PackExistsError';
  }
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Asset references of a pack's JSON file remapped; null for other files and when nothing changed. */
function remapFile(path: string, bytes: Uint8Array, map: (ref: AssetRef) => AssetRef): Uint8Array | null {
  let remapped: string | null = null;
  if (path.toLowerCase().endsWith('.json') && path !== PACK_FILE) {
    try {
      remapped = remapJsonAssets(decoder.decode(bytes), map);
    } catch (error) {
      throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
    }
  }
  return remapped === null ? null : encoder.encode(remapped);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Finds the pack in archive or folder files: `pack.json` at the top, or in the one folder everything sits in
 * (zipping a folder adds it), which is then dropped from the paths.
 */
export function packFilesOf(files: ZipFile[]): PackFiles {
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  const [top] = tops;
  const nested = !files.some((f) => f.path === PACK_FILE) && tops.size === 1 && top !== undefined;
  const prefix = nested ? `${top}/` : '';
  const inPack = files
    .filter((f) => f.path.startsWith(prefix) && f.path.length > prefix.length)
    .map((f) => ({ path: f.path.slice(prefix.length), bytes: f.bytes }));
  const manifestFile = inPack.find((f) => f.path === PACK_FILE);
  if (!manifestFile) {
    throw new Error('No pack.json found: a content pack is a folder or .zip with pack.json at its top');
  }
  let manifest: PackManifest;
  try {
    manifest = packManifestSchema.parse(JSON.parse(decoder.decode(manifestFile.bytes)));
  } catch (error) {
    throw new Error(`pack.json is not valid: ${errorMessage(error)}`, { cause: error });
  }
  return { manifest, files: inPack };
}

export async function readPackZip(bytes: Uint8Array): Promise<PackFiles> {
  return packFilesOf(await readZip(bytes));
}

/**
 * Installs an imported pack in `packs/<id>/`. Asset references inside it name the pack's own files as
 * `packs/<id>/…`, so they point into the data root after import whatever root the pack was exported from.
 * Files go to a staging folder first and are read back and compared; only then is an earlier version replaced.
 */
export async function installPack(repository: Repository, pack: PackFiles, replace: boolean): Promise<void> {
  const { storage } = repository;
  const { id } = pack.manifest;
  const root = `${PACKS_DIR}/${id}`;
  if (id === MY_CONTENT || (await storage.exists('content', `${root}/${PACK_FILE}`))) {
    throw new Error(`"${id}" is the id of a built-in pack; give the pack another id in its pack.json`);
  }
  if (!replace && (await storage.exists('data', `${root}/${PACK_FILE}`))) {
    throw new PackExistsError(pack.manifest);
  }
  // Pack ids have no dots, so the staging folder never lists as a pack.
  const staging = `${root}.importing`;
  await storage.remove(staging);
  const intoDataRoot = (ref: AssetRef): AssetRef =>
    ref.path.startsWith(`${root}/`) ? { area: 'data', path: ref.path } : ref;
  try {
    for (const file of pack.files) {
      const bytes = remapFile(file.path, file.bytes, intoDataRoot) ?? file.bytes;
      const path = `${staging}/${file.path}`;
      await storage.writeBytes(path, bytes);
      if (!sameBytes(await storage.readBytes('data', path), bytes)) {
        throw new Error(`${file.path} was not written intact`);
      }
    }
    await storage.remove(root);
    await storage.copy('data', staging, root);
  } finally {
    await storage.remove(staging);
  }
}

/** Removes an imported pack folder; built-in packs and My content cannot be removed. */
export async function removePack(repository: Repository, id: string): Promise<void> {
  const root = `${PACKS_DIR}/${id}`;
  if (id === MY_CONTENT || !(await repository.storage.exists('data', `${root}/${PACK_FILE}`))) {
    throw new Error(`"${id}" is no imported pack`);
  }
  await repository.storage.remove(root);
}

/**
 * Manifest a pack is exported with: its own, or for My content a dated one, since an export of My content
 * becomes an ordinary pack for whoever imports it.
 */
export function exportManifest(pack: { source: LibrarySource; manifest: PackManifest }, today: Date): PackManifest {
  const date = today.toISOString().slice(0, 10);
  return pack.source.pack === MY_CONTENT
    ? packManifestSchema.parse({
        id: `my-content-${date}`,
        name: `My content ${date}`,
        description: 'Creatures, maps and templates exported from Fogwarden.',
      })
    : pack.manifest;
}

export function packArchiveName(manifest: PackManifest): string {
  const version = manifest.version === '' ? '' : `-${manifest.version.replace(/[^\w.-]+/g, '_')}`;
  return `${manifest.id}${version}.zip`;
}

/**
 * A `.zip` of the pack at `source` with `manifest` as `pack.json` at its top. References to the pack's own
 * files are written as `packs/<id>/…` in the data root, where an import puts them.
 */
export async function exportPack(
  repository: Repository,
  source: LibrarySource,
  manifest: PackManifest,
): Promise<Uint8Array> {
  const { storage } = repository;
  const prefix = `${source.root}/`;
  const intoPack = (ref: AssetRef): AssetRef =>
    ref.area === source.area && ref.path.startsWith(prefix)
      ? { area: 'data', path: `${PACKS_DIR}/${manifest.id}/${ref.path.slice(prefix.length)}` }
      : ref;
  const paths = (await repository.listFiles(source.area, source.root)).filter((p) => p !== `${prefix}${PACK_FILE}`);
  const files: ZipFile[] = [{ path: PACK_FILE, bytes: encoder.encode(formatPackManifest(manifest)) }];
  for (const path of paths) {
    const relative = path.slice(prefix.length);
    const bytes = await storage.readBytes(source.area, path);
    files.push({ path: relative, bytes: remapFile(relative, bytes, intoPack) ?? bytes });
  }
  return writeZip(files);
}
