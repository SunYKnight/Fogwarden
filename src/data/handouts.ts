import { handoutKind, handoutsDir, type HandoutKind } from '@/core/handouts';
import type { AssetRef } from '@/core/model';
import type { Storage } from './storage';

/** A file in a campaign's `handouts` folder that players can be shown. */
export interface HandoutFile {
  name: string;
  kind: HandoutKind;
  asset: AssetRef;
}

/** Pictures, videos and text files of the campaign's handouts folder, by name; other files are left out. */
export async function listHandouts(storage: Storage, campaignId: string): Promise<HandoutFile[]> {
  const dir = handoutsDir(campaignId);
  const entries = await storage.list('data', dir);
  return entries
    .flatMap((entry) => {
      const kind = entry.isDir ? null : handoutKind(entry.name);
      return kind ? [{ name: entry.name, kind, asset: { area: 'data' as const, path: `${dir}/${entry.name}` } }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Copies a file into the handouts folder; a name already taken gets " 2", " 3" … before the extension. */
export async function importHandout(
  storage: Storage,
  campaignId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<HandoutFile> {
  const safeName = fileName.replace(/[^\w.\- ]+/g, '_');
  const kind = handoutKind(safeName);
  if (!kind) {
    throw new Error(`${fileName} is no picture, video or text file`);
  }
  const dot = safeName.lastIndexOf('.');
  const taken = new Set((await storage.list('data', handoutsDir(campaignId))).map((e) => e.name.toLowerCase()));
  let name = safeName;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    name = `${safeName.slice(0, dot)} ${n}${safeName.slice(dot)}`;
  }
  const asset: AssetRef = { area: 'data', path: `${handoutsDir(campaignId)}/${name}` };
  await storage.writeBytes(asset.path, bytes);
  return { name, kind, asset };
}
