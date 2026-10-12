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

  async readBytes(area: StorageArea, path: string): Promise<Uint8Array> {
    return new Uint8Array(await invoke<ArrayBuffer>('storage_read_bytes', { area, path }));
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

/** Copies the data root into the existing empty folder `absolutePath` and switches to it (desktop only). */
export function copyDataRootTo(absolutePath: string): Promise<StorageRoots> {
  return invoke<StorageRoots>('storage_copy_data_root', { path: absolutePath });
}

/** Shows the data root in the OS file manager (desktop only). */
export function openDataRootFolder(): Promise<void> {
  return invoke<void>('storage_open_data_root');
}

/** Entries of a folder the user picked, outside the storage roots (desktop only). */
export function listFolder(absolutePath: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>('storage_list_folder', { path: absolutePath });
}

/** Copies the picked file `absolutePath` into the data area at `to` (desktop only). */
export function importFile(absolutePath: string, to: string): Promise<void> {
  return invoke<void>('storage_import_file', { from: absolutePath, to });
}

/** Text of the picked file `absolutePath` (desktop only). */
export function readFileText(absolutePath: string): Promise<string> {
  return invoke<string>('storage_read_file_text', { path: absolutePath });
}

/** Bytes of the picked file `absolutePath` (desktop only). */
export async function readFileBytes(absolutePath: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await invoke<ArrayBuffer>('storage_read_file_bytes', { path: absolutePath }));
}
