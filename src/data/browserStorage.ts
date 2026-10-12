import type { AssetRef, StorageArea } from '@/core/model';
import { childEntries, StorageError, type DirEntry, type Storage, type StorageRoots } from './storage';

const DB_NAME = 'fogwarden';
const STORE = 'files';

type StoredValue = string | Uint8Array;

function request<T>(req: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
}

/**
 * Storage for running the UI in a plain browser (dev server, tests): user data persists in IndexedDB,
 * shipped content comes from the dev server's content middleware.
 */
export class BrowserStorage implements Storage {
  readonly kind = 'browser' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly objectUrls = new Map<string, string>();

  private db(): Promise<IDBDatabase> {
    if (this.dbPromise === null) {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      this.dbPromise = request(open);
    }
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db()).transaction(STORE, mode).objectStore(STORE);
  }

  private async get(path: string): Promise<StoredValue> {
    const value = await request<StoredValue | undefined>((await this.store('readonly')).get(path));
    if (value === undefined) {
      throw new StorageError('File not found', path);
    }
    return value;
  }

  private async fetchContent(path: string): Promise<Response> {
    const response = await fetch(`/__content/file/${path.split('/').map(encodeURIComponent).join('/')}`);
    if (!response.ok) {
      throw new StorageError(`Content request failed with ${response.status}`, path);
    }
    return response;
  }

  roots(): Promise<StorageRoots> {
    return Promise.resolve({ dataRoot: `indexeddb://${DB_NAME}`, contentRoot: '/__content' });
  }

  setDataRoot(absolutePath: string): Promise<StorageRoots> {
    return Promise.reject(new StorageError('Changing the data root needs the desktop app', absolutePath));
  }

  async readText(area: StorageArea, path: string): Promise<string> {
    const text =
      area === 'content'
        ? await (await this.fetchContent(path)).text()
        : await this.get(path).then((v) => (typeof v === 'string' ? v : new TextDecoder().decode(v)));
    return text;
  }

  async readBytes(area: StorageArea, path: string): Promise<Uint8Array> {
    const bytes =
      area === 'content'
        ? new Uint8Array(await (await this.fetchContent(path)).arrayBuffer())
        : await this.get(path).then((v) => (typeof v === 'string' ? new TextEncoder().encode(v) : v));
    return bytes;
  }

  async writeText(path: string, text: string): Promise<void> {
    await request((await this.store('readwrite')).put(text, path));
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await request((await this.store('readwrite')).put(bytes, path));
    const stale = this.objectUrls.get(path);
    if (stale) {
      URL.revokeObjectURL(stale);
      this.objectUrls.delete(path);
    }
  }

  async list(area: StorageArea, dir: string): Promise<DirEntry[]> {
    const entries =
      area === 'content'
        ? await fetch(`/__content/list?dir=${encodeURIComponent(dir)}`).then((r) => r.json() as Promise<DirEntry[]>)
        : childEntries(dir, (await request((await this.store('readonly')).getAllKeys())).map(String));
    return entries;
  }

  async exists(area: StorageArea, path: string): Promise<boolean> {
    const found =
      area === 'content'
        ? (await fetch(`/__content/file/${path}`, { method: 'HEAD' })).ok
        : (await request((await this.store('readonly')).count(path))) > 0;
    return found;
  }

  async remove(path: string): Promise<void> {
    const store = await this.store('readwrite');
    const keys = (await request(store.getAllKeys())).map(String);
    await Promise.all(keys.filter((k) => k === path || k.startsWith(`${path}/`)).map((k) => request(store.delete(k))));
  }

  async copy(area: StorageArea, from: string, to: string): Promise<void> {
    const files = area === 'content' ? await this.contentFiles(from) : await this.dataFiles(from);
    if (files.length === 0) {
      throw new StorageError('Nothing to copy', from);
    }
    for (const file of files) {
      const value =
        area === 'content' ? new Uint8Array(await (await this.fetchContent(file)).arrayBuffer()) : await this.get(file);
      await request((await this.store('readwrite')).put(value, to + file.slice(from.length)));
    }
  }

  private async dataFiles(prefix: string): Promise<string[]> {
    const keys = (await request((await this.store('readonly')).getAllKeys())).map(String);
    return keys.filter((k) => k === prefix || k.startsWith(`${prefix}/`));
  }

  private async contentFiles(path: string): Promise<string[]> {
    const entries = await this.list('content', path);
    const nested = await Promise.all(
      entries.map((e) => (e.isDir ? this.contentFiles(`${path}/${e.name}`) : Promise.resolve([`${path}/${e.name}`]))),
    );
    return entries.length === 0 ? [path] : nested.flat();
  }

  async assetUrl(ref: AssetRef): Promise<string> {
    const cached = this.objectUrls.get(ref.path);
    const url =
      ref.area === 'content'
        ? `/__content/file/${ref.path.split('/').map(encodeURIComponent).join('/')}`
        : (cached ?? (await this.createObjectUrl(ref.path)));
    return url;
  }

  private async createObjectUrl(path: string): Promise<string> {
    const value = await this.get(path);
    const blob = new Blob([typeof value === 'string' ? value : new Uint8Array(value)]);
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(path, url);
    return url;
  }
}
