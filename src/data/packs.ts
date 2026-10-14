import { z } from 'zod';
import type { AssetRef, LibraryKind, PackSettings, StorageArea } from '@/core/model';

/**
 * Content packs: folders `packs/<id>/` with a `pack.json` and the usual library folders (`creatures/`,
 * `markers/`, `maps/`, `models/`, …). Shipped packs live in the content root, imported ones in the data root;
 * the data root's own `library/` is the always-on pack "My content", which wins every id collision.
 */

export const MY_CONTENT = 'my-content';
export const PACKS_DIR = 'packs';
export const PACK_FILE = 'pack.json';
/** Lower-case words joined by single '-'; no dots, so staging folders never pass as packs. */
export const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where a pack's library folders are: `<area>:<root>/<kind folder>/…`. */
export interface LibrarySource {
  pack: string;
  area: StorageArea;
  root: string;
}

export const MY_CONTENT_SOURCE: LibrarySource = { pack: MY_CONTENT, area: 'data', root: 'library' };

export function packSource(area: StorageArea, id: string): LibrarySource {
  return { pack: id, area, root: `${PACKS_DIR}/${id}` };
}

/** Writable home of `pack`: My content or an imported pack in the data root. */
export function writableSource(pack: string): LibrarySource {
  return pack === MY_CONTENT ? MY_CONTENT_SOURCE : packSource('data', pack);
}

export const packManifestSchema = z.object({
  id: z.string().regex(PACK_ID, 'Pack ids are lower-case words joined by "-"'),
  name: z.string().min(1),
  version: z.string().default(''),
  author: z.string().default(''),
  license: z.string().default(''),
  description: z.string().default(''),
  /** Where the pack comes from (web page or download). */
  url: z.string().default(''),
});
export type PackManifest = z.infer<typeof packManifestSchema>;

export function formatPackManifest(manifest: PackManifest): string {
  return `${JSON.stringify(packManifestSchema.parse(manifest), null, 2)}\n`;
}

export type PackOrigin = 'mine' | 'shipped' | 'user';

export interface InstalledPack {
  source: LibrarySource;
  origin: PackOrigin;
}

/**
 * Packs from highest to lowest precedence: the settings order first, then packs it does not name yet (user
 * packs before shipped ones, each by id), so a new pack never silently changes the order of the others.
 */
export function orderPacks<T extends InstalledPack>(installed: T[], settings: PackSettings): T[] {
  const byId = new Map(installed.map((p) => [p.source.pack, p]));
  const ordered = settings.order.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const named = new Set(settings.order);
  const rank = (p: T) => (p.origin === 'user' ? 0 : 1);
  const rest = installed
    .filter((p) => !named.has(p.source.pack))
    .sort((a, b) => rank(a) - rank(b) || a.source.pack.localeCompare(b.source.pack));
  return [...ordered, ...rest];
}

export function isPackEnabled(id: string, settings: PackSettings): boolean {
  return id === MY_CONTENT || !settings.disabled.includes(id);
}

/** Whether pack `id` contributes its documents of `kind`: enabled and not hiding that kind. */
export function packShowsKind(id: string, kind: LibraryKind, settings: PackSettings): boolean {
  return isPackEnabled(id, settings) && (id === MY_CONTENT || !settings.hiddenKinds[id]?.includes(kind));
}

/** Copy of `value` with every asset reference (`{area, path}` and nothing else) replaced by `map(ref)`. */
export function mapAssetRefs(value: unknown, map: (ref: AssetRef) => AssetRef): unknown {
  let mapped: unknown = value;
  if (Array.isArray(value)) {
    mapped = value.map((item) => mapAssetRefs(item, map));
  } else if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    const ref = value as Partial<AssetRef>;
    const isRef =
      keys.length === 2 &&
      (ref.area === 'data' || ref.area === 'content') &&
      typeof ref.path === 'string' &&
      ref.path !== '';
    mapped = isRef
      ? map(value as AssetRef)
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapAssetRefs(item, map)]));
  }
  return mapped;
}

/**
 * `text` of a JSON document with its asset references mapped, or null when none changed, so files without
 * references keep their bytes. Rewritten files are pretty-printed like every document.
 */
export function remapJsonAssets(text: string, map: (ref: AssetRef) => AssetRef): string | null {
  const before = JSON.parse(text) as unknown;
  const after = mapAssetRefs(before, map);
  const changed = JSON.stringify(after) !== JSON.stringify(before);
  return changed ? `${JSON.stringify(after, null, 2)}\n` : null;
}
