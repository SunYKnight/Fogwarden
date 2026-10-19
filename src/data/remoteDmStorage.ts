import type { AssetRef, StorageArea } from '@/core/model';
import { StorageError, type DirEntry, type Storage, type StorageRoots } from './storage';

/**
 * Storage of the remote DM (the DM's second device on the LAN): the desktop app's data and content areas through
 * the LAN server's `/dm/storage/*` routes, which write through the desktop's version history like its own writes.
 */
export class RemoteDmStorage implements Storage {
  readonly kind = 'remote-dm' as const;
  private readonly writeHandlers = new Set<() => void>();

  /** `serverUrl`: origin of the desktop's LAN server, e.g. `http://192.168.1.5:7717`. */
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
  ) {}

  private url(route: string, query: Record<string, string>): string {
    const params = new URLSearchParams({ ...query, token: this.token });
    return `${this.serverUrl}/dm/storage/${route}?${params.toString()}`;
  }

  private async request(path: string, route: string, query: Record<string, string>, init?: RequestInit) {
    const response = await fetch(this.url(route, query), init);
    if (!response.ok) {
      throw new StorageError(`${response.status} ${(await response.text()) || response.statusText}`, path);
    }
    return response;
  }

  private async changed(write: Promise<unknown>): Promise<void> {
    await write;
    for (const handler of this.writeHandlers) {
      handler();
    }
  }

  /** Calls `handler` after every write, removal and copy this device made; returns the unsubscribe function. */
  watchWrites(handler: () => void): () => void {
    this.writeHandlers.add(handler);
    return () => this.writeHandlers.delete(handler);
  }

  async roots(): Promise<StorageRoots> {
    return (await (await this.request('roots', 'roots', {})).json()) as StorageRoots;
  }

  setDataRoot(absolutePath: string): Promise<StorageRoots> {
    return Promise.reject(new StorageError('Only the desktop app changes its data folder', absolutePath));
  }

  async readText(area: StorageArea, path: string): Promise<string> {
    return (await this.request(path, 'read', { area, path })).text();
  }

  async readBytes(area: StorageArea, path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request(path, 'read', { area, path })).arrayBuffer());
  }

  writeText(path: string, text: string): Promise<void> {
    return this.changed(this.request(path, 'write', { path }, { method: 'PUT', body: text }));
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    // A copy when `bytes` views part of a larger or shared buffer.
    const body = new Uint8Array(bytes);
    return this.changed(this.request(path, 'write', { path }, { method: 'PUT', body }));
  }

  async list(area: StorageArea, dir: string): Promise<DirEntry[]> {
    return (await (await this.request(dir, 'list', { area, path: dir })).json()) as DirEntry[];
  }

  async exists(area: StorageArea, path: string): Promise<boolean> {
    return (await (await this.request(path, 'exists', { area, path })).json()) as boolean;
  }

  remove(path: string): Promise<void> {
    return this.changed(this.request(path, 'remove', { path }, { method: 'POST' }));
  }

  copy(area: StorageArea, from: string, to: string): Promise<void> {
    return this.changed(this.request(from, 'copy', { area, from, to }, { method: 'POST' }));
  }

  assetUrl(ref: AssetRef): Promise<string> {
    const path = ref.path.split('/').map(encodeURIComponent).join('/');
    return Promise.resolve(`${this.serverUrl}/asset/${ref.area}/${path}?token=${encodeURIComponent(this.token)}`);
  }
}
