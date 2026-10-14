import type { AssetRef, StorageArea } from '@/core/model';

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface StorageRoots {
  dataRoot: string;
  contentRoot: string;
}

/**
 * File access for the two storage areas. Paths are relative, '/'-separated and must not leave the area root.
 * `content` is read-only shipped content; `data` is the user's data root.
 */
export interface Storage {
  readonly kind: 'tauri' | 'browser' | 'lan';
  roots(): Promise<StorageRoots>;
  setDataRoot(absolutePath: string): Promise<StorageRoots>;
  readText(area: StorageArea, path: string): Promise<string>;
  readBytes(area: StorageArea, path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  list(area: StorageArea, dir: string): Promise<DirEntry[]>;
  exists(area: StorageArea, path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** Copies a file or folder from `area` into the data area. */
  copy(area: StorageArea, from: string, to: string): Promise<void>;
  /** URL usable by <img>, fetch and three.js loaders. */
  assetUrl(ref: AssetRef): Promise<string>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (${path})`);
    this.name = 'StorageError';
  }
}

/** Immediate children of `dir` derived from a flat list of '/'-separated keys. */
export function childEntries(dir: string, keys: Iterable<string>): DirEntry[] {
  const prefix = dir.length === 0 || dir.endsWith('/') ? dir : `${dir}/`;
  const entries = new Map<string, boolean>();
  for (const key of [...keys].filter((k) => k.startsWith(prefix))) {
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    entries.set(name, (entries.get(name) ?? false) || slash !== -1);
  }
  return [...entries].map(([name, isDir]) => ({ name, isDir })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether a file read back holds exactly the bytes written. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** `name` as a file name: characters outside letters, digits, `.`, `-`, `_` and spaces become `_`. */
export function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_');
}
