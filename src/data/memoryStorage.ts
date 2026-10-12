import type { AssetRef, StorageArea } from '@/core/model';
import { childEntries, StorageError, type DirEntry, type Storage, type StorageRoots } from './storage';

/** Storage held in memory; used by unit tests and command-line tools that stage data before writing it out. */
export class MemoryStorage implements Storage {
  readonly kind = 'browser' as const;
  readonly files: Record<StorageArea, Map<string, string | Uint8Array>> = { data: new Map(), content: new Map() };

  roots(): Promise<StorageRoots> {
    return Promise.resolve({ dataRoot: 'memory://data', contentRoot: 'memory://content' });
  }

  setDataRoot(absolutePath: string): Promise<StorageRoots> {
    return Promise.reject(new StorageError('Memory storage has a fixed root', absolutePath));
  }

  readText(area: StorageArea, path: string): Promise<string> {
    const value = this.files[area].get(path);
    return value === undefined
      ? Promise.reject(new StorageError('File not found', path))
      : Promise.resolve(typeof value === 'string' ? value : new TextDecoder().decode(value));
  }

  readBytes(area: StorageArea, path: string): Promise<Uint8Array> {
    const value = this.files[area].get(path);
    return value === undefined
      ? Promise.reject(new StorageError('File not found', path))
      : Promise.resolve(typeof value === 'string' ? new TextEncoder().encode(value) : value);
  }

  writeText(path: string, text: string): Promise<void> {
    this.files.data.set(path, text);
    return Promise.resolve();
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.data.set(path, bytes);
    return Promise.resolve();
  }

  list(area: StorageArea, dir: string): Promise<DirEntry[]> {
    return Promise.resolve(childEntries(dir, this.files[area].keys()));
  }

  exists(area: StorageArea, path: string): Promise<boolean> {
    return Promise.resolve(this.files[area].has(path));
  }

  remove(path: string): Promise<void> {
    for (const key of [...this.files.data.keys()].filter((k) => k === path || k.startsWith(`${path}/`))) {
      this.files.data.delete(key);
    }
    return Promise.resolve();
  }

  copy(area: StorageArea, from: string, to: string): Promise<void> {
    const matches = [...this.files[area]].filter(([k]) => k === from || k.startsWith(`${from}/`));
    if (matches.length === 0) {
      throw new StorageError('Nothing to copy', from);
    }
    for (const [key, value] of matches) {
      this.files.data.set(to + key.slice(from.length), value);
    }
    return Promise.resolve();
  }

  assetUrl(ref: AssetRef): Promise<string> {
    return Promise.resolve(`memory://${ref.area}/${ref.path}`);
  }
}
