import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { AssetRef, StorageArea } from '@/core/model';
import type { DirEntry, Storage, StorageRoots } from './storage';

const PATH_HEADER = 'x-storage-path';

export class TauriStorage implements Storage {
  readonly kind = 'tauri' as const;

  roots(): Promise<StorageRoots> {
    return invoke<StorageRoots>('storage_roots');
  }

  setDataRoot(absolutePath: string): Promise<StorageRoots> {
    return invoke<StorageRoots>('storage_set_data_root', { path: absolutePath });
  }

  readText(area: StorageArea, path: string): Promise<string> {
    return invoke<string>('storage_read_text', { area, path });
  }

  writeText(path: string, text: string): Promise<void> {
    return invoke<void>('storage_write_text', { path, text });
  }

  // Raw IPC body avoids JSON-encoding image bytes; the path rides a header.
  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return invoke<void>('storage_write_bytes', bytes, { headers: { [PATH_HEADER]: encodeURIComponent(path) } });
  }

  list(area: StorageArea, dir: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>('storage_list', { area, path: dir });
  }

  exists(area: StorageArea, path: string): Promise<boolean> {
    return invoke<boolean>('storage_exists', { area, path });
  }

  remove(path: string): Promise<void> {
    return invoke<void>('storage_remove', { path });
  }

  copy(area: StorageArea, from: string, to: string): Promise<void> {
    return invoke<void>('storage_copy', { area, from, to });
  }

  async assetUrl(ref: AssetRef): Promise<string> {
    const absolute = await invoke<string>('storage_asset_path', { area: ref.area, path: ref.path });
    return convertFileSrc(absolute);
  }
}
