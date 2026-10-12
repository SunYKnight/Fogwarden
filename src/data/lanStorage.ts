import type { AssetRef, StorageArea } from '@/core/model';
import { StorageError, type DirEntry, type Storage, type StorageRoots } from './storage';

function unavailable<T>(path: string): Promise<T> {
  return Promise.reject(new StorageError('The LAN player view can only load map assets', path));
}

/**
 * Storage of the browser player view: map images and models come from the LAN server's `/asset` route; players
 * never read or write documents, since everything else they see arrives filtered over the sync channel.
 */
export class LanStorage implements Storage {
  readonly kind = 'lan' as const;

  /** `serverUrl`: origin of the LAN server, e.g. `http://192.168.1.5:7717`. */
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
  ) {}

  roots(): Promise<StorageRoots> {
    return unavailable('roots');
  }

  setDataRoot(absolutePath: string): Promise<StorageRoots> {
    return unavailable(absolutePath);
  }

  readText(_area: StorageArea, path: string): Promise<string> {
    return unavailable(path);
  }

  writeText(path: string): Promise<void> {
    return unavailable(path);
  }

  writeBytes(path: string): Promise<void> {
    return unavailable(path);
  }

  list(_area: StorageArea, dir: string): Promise<DirEntry[]> {
    return unavailable(dir);
  }

  exists(_area: StorageArea, path: string): Promise<boolean> {
    return unavailable(path);
  }

  remove(path: string): Promise<void> {
    return unavailable(path);
  }

  copy(_area: StorageArea, from: string): Promise<void> {
    return unavailable(from);
  }

  assetUrl(ref: AssetRef): Promise<string> {
    const path = ref.path.split('/').map(encodeURIComponent).join('/');
    return Promise.resolve(`${this.serverUrl}/asset/${ref.area}/${path}?token=${encodeURIComponent(this.token)}`);
  }
}
