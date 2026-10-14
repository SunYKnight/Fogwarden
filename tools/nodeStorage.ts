import { createHash } from 'node:crypto';
import { link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssetRef, StorageArea } from '../src/core/model';
import { StorageError, type DirEntry, type Storage, type StorageRoots } from '../src/data/storage';

/** Same layout as `src-tauri/src/history.rs`, so the app's Settings > History lists what the tools replaced. */
const HISTORY_DIR = 'history';
const OBJECTS_DIR = '.objects';

/** Today's history folder name, `YYYY-MM-DD` in local time like the app's. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Files below the folder `dir`, relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)));
}

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
  private parts(relative: string): string[] {
    const parts = relative.split(/[\\/]/).filter((p) => p !== '' && p !== '.');
    if (isAbsolute(relative) || parts.some((p) => p === '..' || p.includes(':'))) {
      throw new StorageError('Path must stay inside the storage root', relative);
    }
    return parts;
  }

  private resolve(area: StorageArea, relative: string): string {
    return join(area === 'data' ? this.dataRoot : this.contentRoot, ...this.parts(relative));
  }

  /** A data area path the tools may write or remove: anything but the version history. */
  private writableParts(relative: string): string[] {
    const parts = this.parts(relative);
    if (parts[0]?.toLowerCase() === HISTORY_DIR) {
      throw new StorageError('The version history is changed by restores only', relative);
    }
    return parts;
  }

  private static async writeFileAtomic(target: string, data: Uint8Array): Promise<void> {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.tmp`, data);
    await rename(`${target}.tmp`, target);
  }

  /**
   * Keeps the current content of the data file `parts` in today's history folder before `replacement` (null:
   * removal) replaces it, like `history::keep`: once per file and day, contents stored once and hard-linked.
   */
  private async keep(parts: string[], replacement: Uint8Array | null): Promise<void> {
    const current = join(this.dataRoot, ...parts);
    const copy = join(this.dataRoot, HISTORY_DIR, today(), ...parts);
    const staged = parts.some((p) => p.endsWith('.importing'));
    if (existsSync(current) && statSync(current).isFile() && !existsSync(copy) && !staged) {
      const bytes = await readFile(current);
      if (replacement === null || !bytes.equals(replacement)) {
        const sha = createHash('sha256').update(bytes).digest('hex');
        const object = join(this.dataRoot, HISTORY_DIR, OBJECTS_DIR, sha);
        if (!existsSync(object)) {
          await NodeStorage.writeFileAtomic(object, bytes);
        }
        await mkdir(dirname(copy), { recursive: true });
        // File systems without hard links get a copy, as in the app.
        await link(object, copy).catch(() => NodeStorage.writeFileAtomic(copy, bytes));
      }
    }
  }

  private async writeData(relative: string, data: string | Uint8Array): Promise<void> {
    const parts = this.writableParts(relative);
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    await this.keep(parts, bytes);
    await NodeStorage.writeFileAtomic(join(this.dataRoot, ...parts), bytes);
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

  async readBytes(area: StorageArea, path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(area, path)));
  }

  writeText(path: string, text: string): Promise<void> {
    return this.writeData(path, text);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.writeData(path, bytes);
  }

  // The version history is no document folder; only the app lists it.
  async list(area: StorageArea, dir: string): Promise<DirEntry[]> {
    const target = this.resolve(area, dir);
    const atDataRoot = area === 'data' && target === this.dataRoot;
    const entries =
      existsSync(target) && statSync(target).isDirectory() ? await readdir(target, { withFileTypes: true }) : [];
    return entries
      .filter((e) => !atDataRoot || e.name.toLowerCase() !== HISTORY_DIR)
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async exists(area: StorageArea, path: string): Promise<boolean> {
    return existsSync(this.resolve(area, path));
  }

  async remove(path: string): Promise<void> {
    const parts = this.writableParts(path);
    const target = join(this.dataRoot, ...parts);
    if (target === this.dataRoot) {
      throw new StorageError('Refusing to remove the data root', path);
    }
    const files = existsSync(target) && statSync(target).isDirectory() ? await filesUnder(target) : [''];
    for (const file of files) {
      await this.keep([...parts, ...this.parts(file)], null);
    }
    await rm(target, { recursive: true, force: true });
  }

  /** File by file like any write, so the history keeps what the copy replaces. */
  async copy(area: StorageArea, from: string, to: string): Promise<void> {
    const source = this.resolve(area, from);
    if (!existsSync(source)) {
      throw new StorageError('Nothing to copy', from);
    }
    const files = (await stat(source)).isDirectory() ? await filesUnder(source) : [''];
    for (const file of files) {
      await this.writeData(join(to, file), await readFile(join(source, file)));
    }
  }

  async assetUrl(ref: AssetRef): Promise<string> {
    return pathToFileURL(this.resolve(ref.area, ref.path)).href;
  }
}
