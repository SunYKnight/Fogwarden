import { z } from 'zod';
import type { Repository } from './repository';

/** The free D&D 5e API (https://www.dnd5eapi.co): stat blocks and one painted picture per SRD 5.1 monster. */
export const DND5E_API = 'https://www.dnd5eapi.co';

const listSchema = z.object({ results: z.array(z.object({ index: z.string(), name: z.string() })) });

// The API's PNGs are about 1.7 MB each; tokens and previews never need more.
const MAX_SIDE = 768;
const PARALLEL_DOWNLOADS = 4;

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`D&D 5e API download failed (HTTP ${response.status}): ${url}`);
  }
  return response;
}

// The shipped SRD creatures are `srd-<monster index>`; naming the files that
// way matches them by id, also forms like "Werewolf, Human Form".
const SRD_PREFIX = 'srd-';

/** Picture file names the API offers, `srd-<monster index>.png`, ready for `matchPortraits`. */
export async function listApiPictures(): Promise<string[]> {
  const list = listSchema.parse(await (await fetchOk(`${DND5E_API}/api/2014/monsters`)).json());
  return list.results.map((monster) => `${SRD_PREFIX}${monster.index}.png`);
}

async function shrinkToJpeg(picture: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(picture);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No 2D canvas to shrink pictures with');
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Uint8Array(await jpeg.arrayBuffer());
}

export interface ApiPicture {
  creatureId: string;
  fileName: string;
}

/**
 * Downloads each picture, shrinks it to a JPEG and stores it as the creature's image in My content, which
 * pictures pack creatures too. Returns the creatures the API has no picture for.
 */
export async function downloadApiPictures(
  repository: Repository,
  plan: readonly ApiPicture[],
  onProgress: (done: number) => void,
): Promise<string[]> {
  const queue = [...plan];
  const missing: string[] = [];
  let done = 0;
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const file = next.fileName.slice(SRD_PREFIX.length);
      const response = await fetch(`${DND5E_API}/api/images/monsters/${file}`);
      if (response.status === 404) {
        missing.push(next.creatureId);
      } else if (!response.ok) {
        throw new Error(`D&D 5e API download failed (HTTP ${response.status}): ${next.fileName}`);
      } else {
        const jpeg = await shrinkToJpeg(await response.blob());
        await repository.importCreaturePicture(next.creatureId, 'image', `${next.creatureId}.jpg`, jpeg);
      }
      done += 1;
      onProgress(done);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
  return missing;
}
