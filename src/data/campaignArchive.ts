import { z } from 'zod';
import {
  campaignFileSchema,
  encounterFileSchema,
  idSchema,
  mapFileSchema,
  markerTemplateSchema,
  timestampSchema,
  type AssetRef,
  type DocRef,
  type EncounterFile,
} from '@/core/model';
import { readZip, writeZip, type ZipFile } from '@/core/zip';
import { version as APP_VERSION } from '../../package.json';
import { migrate } from './migrations';
import { sameBytes } from './packArchive';
import { mapAssetRefs, MY_CONTENT, MY_CONTENT_SOURCE, remapJsonAssets, type LibrarySource } from './packs';
import {
  campaignPath,
  KIND_LAYOUTS,
  libraryDir,
  libraryDocPath,
  type LibraryKind,
  type Repository,
} from './repository';
import type { Storage } from './storage';

/**
 * Campaign archives: a `.zip` with this manifest at its top and the campaign's files under the paths they have
 * in the data root (`campaigns/<id>/…`), plus the My content documents and files the campaign refers to
 * (`library/…`). Pack content is only named in the manifest: the importer installs those packs.
 */
export const CAMPAIGN_MANIFEST_FILE = 'fogwarden-campaign.json';
export const CAMPAIGN_ARCHIVE_EXTENSION = '.fogwarden-campaign.zip';
const ARCHIVE_FORMAT = 1;
/** Library kinds encounters refer to by id; maps last, so their files see where the others went. */
const BUNDLED_KINDS = ['creature', 'marker', 'map'] as const;
type BundledKind = (typeof BUNDLED_KINDS)[number];
/** Folder of the imported campaign for files that cannot keep their path in the data root. */
const IMPORTED_ASSETS = 'imported-assets';
const PACK_PATH = /^packs\/([a-z0-9]+(?:-[a-z0-9]+)*)\//;
const ENCOUNTER_FILE = /^encounters\/[^/]+\/encounter\.json$/;
const STAGING_DIR = 'campaigns.importing';
const CAMPAIGN_FILE = 'campaign.json';

/** Ids become folder and file names, so they must not climb out of their folder. */
const fileIdSchema = idSchema.regex(/^[^./\\][^/\\]*$/, 'Ids are plain file names');

const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  /** Fogwarden version that wrote the archive. */
  app: z.string(),
  exportedAt: timestampSchema,
  campaign: z.object({ id: fileIdSchema, name: z.string() }),
  /** My content documents the campaign uses, with every file that belongs to them. */
  library: z.array(z.object({ kind: z.enum(BUNDLED_KINDS), id: fileIdSchema, files: z.array(z.string().min(1)) })),
  /** Other data root files the campaign or its maps refer to. */
  assets: z.array(z.string().min(1)),
  /** Packs whose documents or files the campaign uses; they are not in the archive. */
  packs: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type CampaignManifest = z.infer<typeof manifestSchema>;
type BundledDoc = CampaignManifest['library'][number];
export type RequiredPack = CampaignManifest['packs'][number];

/** A read archive: its manifest and its files by path. */
export interface CampaignArchive {
  manifest: CampaignManifest;
  files: Map<string, Uint8Array>;
}

/** A campaign with the archive's id exists; the import then replaces it or becomes a copy. */
export class CampaignExistsError extends Error {
  constructor(readonly manifest: CampaignManifest) {
    super(`A campaign "${manifest.campaign.id}" exists already`);
    this.name = 'CampaignExistsError';
  }
}

/** What an import does when the campaign exists: stop with `CampaignExistsError`, replace it, or copy. */
export type CampaignConflict = 'fail' | 'replace' | 'copy';

export interface CampaignImport {
  id: string;
  name: string;
  /** Required packs that are not installed; their documents stay missing until they are. */
  missingPacks: RequiredPack[];
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pretty-printed like every document. */
function formatJson(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** First installed pack (enabled or not) holding document `id`, by precedence; null when none does. */
async function holderOf(
  storage: Storage,
  sources: LibrarySource[],
  kind: LibraryKind,
  id: string,
): Promise<LibrarySource | null> {
  const held = await Promise.all(sources.map((s) => storage.exists(s.area, libraryDocPath(kind, s, id))));
  return sources[held.indexOf(true)] ?? null;
}

/** Library documents and asset references in the JSON files of a campaign folder. */
async function campaignReferences(storage: Storage, root: string, paths: string[]) {
  const docs = new Map<string, { kind: BundledKind; id: string }>();
  const assets: AssetRef[] = [];
  for (const path of paths.filter((p) => p.endsWith('.json'))) {
    const text = await storage.readText('data', path);
    try {
      const json: unknown = JSON.parse(text);
      mapAssetRefs(json, (ref) => {
        assets.push(ref);
        return ref;
      });
      const relative = path.slice(root.length + 1);
      const encounter = ENCOUNTER_FILE.test(relative) ? encounterFileSchema.parse(migrate('encounter', json)) : null;
      const campaign = relative === CAMPAIGN_FILE ? campaignFileSchema.parse(migrate('campaign', json)) : null;
      const refs: { kind: BundledKind; id: string }[] = [
        ...(encounter?.map ? [{ kind: 'map' as const, id: encounter.map.id }] : []),
        ...(encounter?.combatants ?? []).flatMap((c) =>
          c.creature ? [{ kind: 'creature' as const, id: c.creature.id }] : [],
        ),
        ...(encounter?.markers ?? []).flatMap((m) =>
          m.templateId ? [{ kind: 'marker' as const, id: m.templateId }] : [],
        ),
        ...(campaign?.party ?? []).map((m) => ({ kind: 'creature' as const, id: m.creature.id })),
      ];
      refs.forEach((ref) => docs.set(`${ref.kind}:${ref.id}`, ref));
    } catch (error) {
      throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
    }
  }
  return { docs: [...docs.values()], assets };
}

/** Files of a My content document: a map's folder, a creature's stat block and pictures, a template. */
async function docFiles(repository: Repository, kind: BundledKind, id: string): Promise<string[]> {
  const dir = libraryDir(kind, MY_CONTENT_SOURCE);
  const files = KIND_LAYOUTS[kind].folder
    ? await repository.listFiles('data', `${dir}/${id}`)
    : (await repository.storage.list('data', dir))
        .filter((e) => !e.isDir && e.name.startsWith(`${id}.`))
        .map((e) => `${dir}/${e.name}`);
  return files;
}

/**
 * A `.zip` of the campaign folder with the My content documents (maps, creatures, area templates) and data
 * root files its encounters use; documents and files of packs are listed as required packs instead.
 */
export async function exportCampaign(repository: Repository, campaignId: string, now: Date): Promise<Uint8Array> {
  const { storage } = repository;
  const root = `campaigns/${campaignId}`;
  const campaign = campaignFileSchema.parse(
    migrate('campaign', JSON.parse(await storage.readText('data', campaignPath(campaignId)))),
  );
  const campaignFiles = await repository.listFiles('data', root);
  const sources = (await repository.installedPacks()).map((p) => p.source);
  const { docs, assets } = await campaignReferences(storage, root, campaignFiles);
  const library: BundledDoc[] = [];
  const packIds = new Set<string>();
  for (const { kind, id } of docs) {
    const holder = await holderOf(storage, sources, kind, id);
    if (holder?.pack === MY_CONTENT) {
      library.push({ kind, id, files: await docFiles(repository, kind, id) });
      if (kind === 'map') {
        const map: unknown = JSON.parse(await storage.readText('data', libraryDocPath(kind, holder, id)));
        mapAssetRefs(map, (ref) => {
          assets.push(ref);
          return ref;
        });
      }
    } else if (holder) {
      packIds.add(holder.pack);
    }
  }
  const bundled = new Set([...campaignFiles, ...library.flatMap((d) => d.files)]);
  const loose = new Set<string>();
  for (const ref of assets) {
    const pack = PACK_PATH.exec(ref.path)?.[1];
    if (pack !== undefined) {
      packIds.add(pack);
    } else if (ref.area === 'data' && !bundled.has(ref.path) && (await storage.exists('data', ref.path))) {
      loose.add(ref.path);
    }
  }
  const installed = packIds.size > 0 ? (await repository.listPacks()).packs : [];
  const manifest = manifestSchema.parse({
    format: ARCHIVE_FORMAT,
    app: APP_VERSION,
    exportedAt: now.toISOString(),
    campaign: { id: campaignId, name: campaign.name },
    library,
    assets: [...loose].sort(),
    packs: [...packIds]
      .sort()
      .map((id) => ({ id, name: installed.find((p) => p.source.pack === id)?.manifest.name ?? id })),
  });
  const files: ZipFile[] = [{ path: CAMPAIGN_MANIFEST_FILE, bytes: encoder.encode(formatJson(manifest)) }];
  for (const path of [...bundled, ...manifest.assets]) {
    files.push({ path, bytes: await storage.readBytes('data', path) });
  }
  return writeZip(files);
}

/** Reads a campaign archive and checks that the manifest's files are in it and in their folders. */
export async function readCampaignZip(bytes: Uint8Array): Promise<CampaignArchive> {
  const files = new Map((await readZip(bytes)).map((f) => [f.path, f.bytes]));
  const manifestBytes = files.get(CAMPAIGN_MANIFEST_FILE);
  if (!manifestBytes) {
    throw new Error(`No ${CAMPAIGN_MANIFEST_FILE} found: this is no Fogwarden campaign archive`);
  }
  let manifest: CampaignManifest;
  try {
    manifest = manifestSchema.parse(JSON.parse(decoder.decode(manifestBytes)));
  } catch (error) {
    throw new Error(`${CAMPAIGN_MANIFEST_FILE} is not valid: ${errorMessage(error)}`, { cause: error });
  }
  const strays = manifest.library.flatMap(({ kind, id, files: paths }) => {
    const prefix = `${libraryDir(kind, MY_CONTENT_SOURCE)}/${id}${KIND_LAYOUTS[kind].folder ? '/' : '.'}`;
    return paths.filter((p) => !p.startsWith(prefix));
  });
  const listed = [campaignPath(manifest.campaign.id), ...manifest.library.flatMap((d) => d.files), ...manifest.assets];
  const missing = listed.filter((p) => !files.has(p));
  if (strays.length > 0) {
    throw new Error(`${CAMPAIGN_MANIFEST_FILE} lists files outside their document: ${strays.join(', ')}`);
  }
  if (missing.length > 0) {
    throw new Error(`The campaign archive lacks ${missing.join(', ')}`);
  }
  return { manifest, files };
}

/** Bytes of a data root file; null when there is none. */
async function dataFile(storage: Storage, path: string): Promise<Uint8Array | null> {
  return (await storage.exists('data', path)) ? storage.readBytes('data', path) : null;
}

/** `name (2)`, `name (3)` … whichever no campaign is called yet. */
async function copyName(repository: Repository, name: string): Promise<string> {
  const names = new Set((await repository.listCampaigns()).campaigns.map((c) => c.name));
  let n = 2;
  while (names.has(`${name} (${n})`)) {
    n++;
  }
  return `${name} (${n})`;
}

/** Where an import puts things: the campaign's id and name, documents' new ids, files' new paths. */
interface Placement {
  from: string;
  id: string;
  name: string;
  renamed: Record<BundledKind, Map<string, string>>;
  /** Data root path by archive path, for files that could not keep theirs. */
  moved: Map<string, string>;
  moveAsset: (ref: AssetRef) => AssetRef;
}

/** `change` applied to a JSON file of the archive (null: unchanged); errors name the file. */
function rewriteJson(path: string, bytes: Uint8Array, change: (text: string) => string | null): Uint8Array {
  let text: string | null;
  try {
    text = change(decoder.decode(bytes));
  } catch (error) {
    throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
  }
  return text === null ? bytes : encoder.encode(text);
}

/**
 * Writes a bundled document into My content. An identical copy there is used as it is; when another
 * document has its id (in My content or any pack), it gets a free id and its files move along.
 */
async function placeDoc(
  repository: Repository,
  sources: LibrarySource[],
  files: Map<string, Uint8Array>,
  doc: BundledDoc,
  placement: Placement,
): Promise<void> {
  const { storage } = repository;
  const present = await Promise.all(
    doc.files.map(async (p) => {
      const old = await dataFile(storage, p);
      return old !== null && sameBytes(old, files.get(p)!);
    }),
  );
  if (!present.every(Boolean)) {
    const taken = (await holderOf(storage, sources, doc.kind, doc.id)) !== null;
    const id = taken ? await repository.newLibraryId(doc.kind, doc.id) : doc.id;
    const prefix = `${libraryDir(doc.kind, MY_CONTENT_SOURCE)}/`;
    const docPath = libraryDocPath(doc.kind, MY_CONTENT_SOURCE, doc.id);
    if (taken) {
      placement.renamed[doc.kind].set(doc.id, id);
      doc.files.forEach((p) => placement.moved.set(p, `${prefix}${id}${p.slice(prefix.length + doc.id.length)}`));
    }
    // A creature's id is its file name; maps and templates also hold it.
    const withOwnId = (text: string) => {
      const raw = migrate(doc.kind === 'map' ? 'map' : 'marker', JSON.parse(text));
      const parsed = doc.kind === 'map' ? mapFileSchema.parse(raw) : markerTemplateSchema.parse(raw);
      return formatJson(mapAssetRefs({ ...parsed, id }, placement.moveAsset));
    };
    for (const path of doc.files) {
      const bytes = files.get(path)!;
      const written =
        taken && path === docPath && doc.kind !== 'creature'
          ? rewriteJson(path, bytes, withOwnId)
          : path.endsWith('.json')
            ? rewriteJson(path, bytes, (text) => remapJsonAssets(text, placement.moveAsset))
            : bytes;
      await storage.writeBytes(placement.moved.get(path) ?? path, written);
    }
  }
}

/** `ref` with the document's new id when the import gave it one. */
function placedRef(placement: Placement, kind: BundledKind, ref: DocRef): DocRef {
  const id = placement.renamed[kind].get(ref.id);
  return id ? { area: 'data', id } : ref;
}

/** An encounter of the imported campaign, pointing at the campaign's id and the documents' new ids. */
function placedEncounter(encounter: EncounterFile, placement: Placement): unknown {
  const { renamed } = placement;
  const placed: EncounterFile = {
    ...encounter,
    campaignId: placement.id,
    map: encounter.map && placedRef(placement, 'map', encounter.map),
    combatants: encounter.combatants.map((c) => ({
      ...c,
      creature: c.creature && placedRef(placement, 'creature', c.creature),
    })),
    markers: encounter.markers.map((m) => ({
      ...m,
      templateId: m.templateId && (renamed.marker.get(m.templateId) ?? m.templateId),
    })),
  };
  return mapAssetRefs(placed, placement.moveAsset);
}

/** A file of the campaign folder as written: ids, name and asset references updated where they changed. */
function placedCampaignFile(relative: string, bytes: Uint8Array, placement: Placement): Uint8Array {
  const { from, id, name, renamed } = placement;
  const idsChanged = id !== from || Object.values(renamed).some((m) => m.size > 0);
  const path = `campaigns/${from}/${relative}`;
  const placed =
    relative === CAMPAIGN_FILE && idsChanged
      ? rewriteJson(path, bytes, (text) => {
          const campaign = campaignFileSchema.parse(migrate('campaign', JSON.parse(text)));
          const party = campaign.party.map((m) => ({ ...m, creature: placedRef(placement, 'creature', m.creature) }));
          return formatJson({ ...campaign, id, name, party });
        })
      : ENCOUNTER_FILE.test(relative) && idsChanged
        ? rewriteJson(path, bytes, (text) =>
            formatJson(placedEncounter(encounterFileSchema.parse(migrate('encounter', JSON.parse(text))), placement)),
          )
        : relative.endsWith('.json')
          ? rewriteJson(path, bytes, (text) => remapJsonAssets(text, placement.moveAsset))
          : bytes;
  return placed;
}

/**
 * Imports a campaign archive. Bundled documents go into My content, under a free id when theirs is taken
 * by another document; references in the campaign follow. The campaign folder is written to a staging
 * folder, read back and compared first, and only then replaces an existing one. Files keep their bytes
 * unless a reference in them changes, so migrations run when they load, as for any other file.
 */
export async function importCampaign(
  repository: Repository,
  archive: CampaignArchive,
  conflict: CampaignConflict,
): Promise<CampaignImport> {
  const { storage } = repository;
  const { manifest, files } = archive;
  const from = manifest.campaign.id;
  const exists = (await storage.list('data', `campaigns/${from}`)).length > 0;
  if (exists && conflict === 'fail') {
    throw new CampaignExistsError(manifest);
  }
  const copy = exists && conflict === 'copy';
  const name = copy ? await copyName(repository, manifest.campaign.name) : manifest.campaign.name;
  const id = copy ? await repository.newCampaignId(name) : from;
  const fromRoot = `campaigns/${from}/`;
  const root = `campaigns/${id}`;
  const moved = new Map<string, string>();
  const placement: Placement = {
    from,
    id,
    name,
    renamed: { creature: new Map(), marker: new Map(), map: new Map() },
    moved,
    moveAsset: (ref) => {
      const own = ref.path.startsWith(fromRoot) ? `${root}/${ref.path.slice(fromRoot.length)}` : ref.path;
      const path = ref.area === 'data' ? (moved.get(ref.path) ?? own) : ref.path;
      return path === ref.path ? ref : { area: 'data', path };
    },
  };
  const staged: ZipFile[] = [];
  for (const path of manifest.assets) {
    const bytes = files.get(path)!;
    const old = await dataFile(storage, path);
    // Elsewhere (another campaign's folder, say) it would not belong.
    if (path.startsWith(`${MY_CONTENT_SOURCE.root}/`) && (old === null || sameBytes(old, bytes))) {
      await storage.writeBytes(path, bytes);
    } else {
      staged.push({ path: `${IMPORTED_ASSETS}/${path}`, bytes });
      moved.set(path, `${root}/${IMPORTED_ASSETS}/${path}`);
    }
  }
  const sources = (await repository.installedPacks()).map((p) => p.source);
  const docs = manifest.library.toSorted((a, b) => BUNDLED_KINDS.indexOf(a.kind) - BUNDLED_KINDS.indexOf(b.kind));
  for (const doc of docs) {
    await placeDoc(repository, sources, files, doc, placement);
  }
  for (const [path, bytes] of [...files].filter(([p]) => p.startsWith(fromRoot))) {
    const relative = path.slice(fromRoot.length);
    staged.push({ path: relative, bytes: placedCampaignFile(relative, bytes, placement) });
  }
  // Outside `campaigns/`, so no listing shows a half-written campaign.
  const staging = `${STAGING_DIR}/${id}`;
  await storage.remove(STAGING_DIR);
  try {
    for (const file of staged) {
      const path = `${staging}/${file.path}`;
      await storage.writeBytes(path, file.bytes);
      if (!sameBytes(await storage.readBytes('data', path), file.bytes)) {
        throw new Error(`${file.path} was not written intact`);
      }
    }
    await storage.remove(root);
    await storage.copy('data', staging, root);
  } finally {
    await storage.remove(STAGING_DIR);
  }
  const installed = new Set(sources.map((s) => s.pack));
  return { id, name, missingPacks: manifest.packs.filter((p) => !installed.has(p.id)) };
}
