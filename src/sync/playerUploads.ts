import type { AssetRef } from '@/core/model';
import type { Storage } from '@/data/storage';
import { PLAYER_UPLOAD_MAX_BYTES, sniffPicture, type PlayerUpload } from './relayApi';

/** A server holding player uploads for the DM: the LAN server or the relay. */
export interface PlayerUploadSource {
  /** Calls `handler` with the waiting uploads: now and whenever the server reports them. */
  watchUploads(handler: (uploads: readonly PlayerUpload[]) => void): () => void;
  fetchUpload(id: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Deleting an upload that is gone already is no error. */
  deleteUpload(id: string): Promise<void>;
}

/**
 * Checks a fetched upload against what the server announced: a relay only looked at the first bytes, and one
 * that was tampered with must not get anything else into the campaign.
 */
export function checkPlayerUpload(upload: PlayerUpload, bytes: Uint8Array): void {
  const problems = [
    [bytes.length > PLAYER_UPLOAD_MAX_BYTES, `is larger than ${PLAYER_UPLOAD_MAX_BYTES} bytes`],
    [bytes.length !== upload.size, `has ${bytes.length} bytes instead of the announced ${upload.size}`],
    [sniffPicture(bytes) !== upload.type, `is no ${upload.type.toUpperCase()} picture`],
  ] as const;
  const problem = problems.find(([found]) => found);
  if (problem) {
    throw new Error(`The picture "${upload.name}" ${problem[1]}`);
  }
}

/**
 * Writes an accepted upload into the campaign as `<id>.<type>` under its view's folder. The id is the server's
 * random hex and the view matched `RELAY_VIEW_PATTERN`, so the player's own file name never becomes a path.
 */
export async function storePlayerUpload(
  storage: Storage,
  campaignId: string,
  upload: PlayerUpload,
  bytes: Uint8Array,
): Promise<AssetRef> {
  checkPlayerUpload(upload, bytes);
  const ref: AssetRef = {
    area: 'data',
    path: `campaigns/${campaignId}/players/${upload.view}/uploads/${upload.id}.${upload.type}`,
  };
  await storage.writeBytes(ref.path, bytes);
  return ref;
}
