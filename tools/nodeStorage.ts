import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssetRef, StorageArea } from '../src/core/model';
import { StorageError, type DirEntry, type Storage, type StorageRoots } from '../src/data/storage';

/** File system storage for command-line tools; same layout and path rules as the desktop app's Rust side. */
export class NodeStorage implements Storage {
  // Same on-disk semantics as the desktop storage.
  readonly kind = 'tauri' as const;
  private dataRoot: string;
  private readonly contentRoot: string;

  constructor(dataRoot: string, contentRoot: string) {
    this.dataRoot = resolve(dataRoot);
    this.contentRoot = resolve(contentRoot);
  }

  /** Only plain relative segments: no absolute paths, drive letters or `..`. */
  private resolve(area: StorageArea, relative: string): string {
    const parts = relative.split(/[\\/]/).filter((p) => p !== '' && p !== '.');
    if (isAbsolute(relative) || parts.some((p) => p === '..' || p.includes(':'))) {
      throw new StorageError('Path must stay inside the storage root', relative);
    }
    return join(area === 'data' ? this.dataRoot : this.contentRoot, ...parts);
  }

  private async writeAtomic(relative: string, data: string | Uint8Array): Promise<void> {
    const target = this.resolve('data', relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.tmp`, data);
    await rename(`${target}.tmp`, target);
  }

  roots(): Promise<StorageRoots> {
    return Promise.resolve({ dataRoot: this.dataRoot, contentRoot: this.contentRoot });
  }

  async setDataRoot(absolutePath: string): Promise<StorageRoots> {
    await mkdir(absolutePath, { recursive: true });
    this.dataRoot = resolve(absolutePath);
    return this.roots();
  }

  // Async so path errors reject like I/O errors instead of throwing.
  async readText(area: StorageArea, path: string): Promise<string> {
    return readFile(this.resolve(area, path), 'utf8');
  }

  writeText(path: string, text: string): Promise<void> {
    return this.writeAtomic(path, text);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.writeAtomic(path, bytes);
  }

  async list(area: StorageArea, dir: string): Promise<DirEntry[]> {
    const target = this.resolve(area, dir);
    const entries =
      existsSync(target) && statSync(target).isDirectory() ? await readdir(target, { withFileTypes: true }) : [];
    return entries
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async exists(area: StorageArea, path: string): Promise<boolean> {
    return existsSync(this.resolve(area, path));
  }

  async remove(path: string): Promise<void> {
    const target = this.resolve('data', path);
    if (target === this.dataRoot) {
      throw new StorageError('Refusing to remove the data root', path);
    }
    await rm(target, { recursive: true, force: true });
  }

  async copy(area: StorageArea, from: string, to: string): Promise<void> {
    const source = this.resolve(area, from);
    const target = this.resolve('data', to);
    if (!existsSync(source)) {
      throw new StorageError('Nothing to copy', from);
    }
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: (await stat(source)).isDirectory() });
  }

  async assetUrl(ref: AssetRef): Promise<string> {
    return pathToFileURL(this.resolve(ref.area, ref.path)).href;
  }
}
