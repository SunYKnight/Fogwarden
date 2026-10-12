import type { z } from 'zod';
import {
  campaignSchema,
  creatureSchema,
  defaultSettings,
  encounterSchema,
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
  type MarkerTemplate,
  type Settings,
  type StorageArea,
} from '@/core/model';
import { migrate, type SchemaName } from './migrations';
import type { Storage } from './storage';

export type LibraryKind = 'creature' | 'marker' | 'map';

export interface LibraryDocs {
  creature: Creature;
  marker: MarkerTemplate;
  map: BattleMap;
}

const LIBRARY_SCHEMAS: { [K in LibraryKind]: z.ZodType<LibraryDocs[K]> } = {
  creature: creatureSchema,
  marker: markerTemplateSchema,
  map: mapSchema,
};

const LIBRARY_DIRS: Record<LibraryKind, { data: string; content: string }> = {
  creature: { data: 'library/creatures', content: 'creatures' },
  marker: { data: 'library/markers', content: 'markers' },
  map: { data: 'library/maps', content: 'maps' },
};

const SETTINGS_PATH = 'settings.json';

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

/** Maps are folders so their images and models travel with them. */
export function libraryDocPath(kind: LibraryKind, area: StorageArea, id: string): string {
  const dir = LIBRARY_DIRS[kind][area];
  return kind === 'map' ? `${dir}/${id}/map.json` : `${dir}/${id}.json`;
}

export function mapAssetRef(mapId: string, fileName: string): AssetRef {
  return { area: 'data', path: `${LIBRARY_DIRS.map.data}/${mapId}/assets/${fileName}` };
}

export function campaignPath(id: string): string {
  return `campaigns/${id}/campaign.json`;
}

export function encounterPath(campaignId: string, id: string): string {
  return `campaigns/${campaignId}/encounters/${id}.json`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Repository {
  constructor(readonly storage: Storage) {}

  private async readDoc<T>(schemaName: SchemaName, schema: z.ZodType<T>, area: StorageArea, path: string) {
    const text = await this.storage.readText(area, path);
    let parsed: T;
    try {
      parsed = schema.parse(migrate(schemaName, JSON.parse(text)));
    } catch (error) {
      throw new DataError(errorMessage(error), area, path);
    }
    return parsed;
  }

  private writeDoc(path: string, doc: unknown): Promise<void> {
    return this.storage.writeText(path, `${JSON.stringify(doc, null, 2)}\n`);
  }

  load<K extends LibraryKind>(kind: K, ref: DocRef): Promise<LibraryDocs[K]> {
    return this.readDoc(kind, LIBRARY_SCHEMAS[kind], ref.area, libraryDocPath(kind, ref.area, ref.id));
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
    await Promise.all([this.listArea(kind, 'content', content), this.listArea(kind, 'data', data)]);
    const userIds = new Set(data.entries.map((e) => e.ref.id));
    const entries = [
      ...content.entries.filter((e) => !userIds.has(e.ref.id)),
      ...data.entries.map((e) => ({ ...e, overridesContent: content.entries.some((c) => c.ref.id === e.ref.id) })),
    ].sort((a, b) => a.doc.name.localeCompare(b.doc.name));
    return { entries, problems: [...content.problems, ...data.problems] };
  }

  /** Always writes to the data area; saving a shipped document creates the user override. */
  async save<K extends LibraryKind>(kind: K, doc: LibraryDocs[K]): Promise<LibraryDocs[K]> {
    const stamped = { ...LIBRARY_SCHEMAS[kind].parse(doc), updatedAt: nowIso() };
    await this.writeDoc(libraryDocPath(kind, 'data', stamped.id), stamped);
    return stamped;
  }

  remove(kind: LibraryKind, id: string): Promise<void> {
    const path = kind === 'map' ? `${LIBRARY_DIRS.map.data}/${id}` : libraryDocPath(kind, 'data', id);
    return this.storage.remove(path);
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
    const fromDir = `${LIBRARY_DIRS.map[ref.area]}/${ref.id}/assets`;
    const toDir = `${LIBRARY_DIRS.map.data}/${id}/assets`;
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

  async listCampaigns(): Promise<{ campaigns: Campaign[]; problems: LoadProblem[] }> {
    const dirs = (await this.storage.list('data', 'campaigns')).filter((e) => e.isDir).map((e) => e.name);
    const results = await Promise.allSettled(
      dirs.map((id) => this.readDoc('campaign', campaignSchema, 'data', campaignPath(id))),
    );
    const campaigns: Campaign[] = [];
    const problems: LoadProblem[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        campaigns.push(result.value);
      } else {
        problems.push({ area: 'data', path: campaignPath(dirs[i]!), message: errorMessage(result.reason) });
      }
    });
    return { campaigns: campaigns.sort((a, b) => a.name.localeCompare(b.name)), problems };
  }

  async saveCampaign(campaign: Campaign): Promise<Campaign> {
    const stamped = { ...campaignSchema.parse(campaign), updatedAt: nowIso() };
    await this.writeDoc(campaignPath(stamped.id), stamped);
    return stamped;
  }

  async listEncounters(campaignId: string): Promise<{ encounters: Encounter[]; problems: LoadProblem[] }> {
    const files = (await this.storage.list('data', `campaigns/${campaignId}/encounters`))
      .filter((e) => !e.isDir && e.name.endsWith('.json'))
      .map((e) => e.name.slice(0, -'.json'.length));
    const results = await Promise.allSettled(files.map((id) => this.loadEncounter(campaignId, id)));
    const encounters: Encounter[] = [];
    const problems: LoadProblem[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        encounters.push(result.value);
      } else {
        const path = encounterPath(campaignId, files[i]!);
        problems.push({ area: 'data', path, message: errorMessage(result.reason) });
      }
    });
    return { encounters: encounters.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), problems };
  }

  loadEncounter(campaignId: string, id: string): Promise<Encounter> {
    return this.readDoc('encounter', encounterSchema, 'data', encounterPath(campaignId, id));
  }

  async saveEncounter(encounter: Encounter): Promise<Encounter> {
    const stamped = { ...encounterSchema.parse(encounter), updatedAt: nowIso() };
    await this.writeDoc(encounterPath(stamped.campaignId, stamped.id), stamped);
    return stamped;
  }

  removeEncounter(campaignId: string, id: string): Promise<void> {
    return this.storage.remove(encounterPath(campaignId, id));
  }

  async loadSettings(): Promise<Settings> {
    const exists = await this.storage.exists('data', SETTINGS_PATH);
    return exists ? this.readDoc('settings', settingsSchema, 'data', SETTINGS_PATH) : defaultSettings();
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    const parsed = settingsSchema.parse(settings);
    await this.writeDoc(SETTINGS_PATH, parsed);
    return parsed;
  }
}
