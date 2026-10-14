import { z } from 'zod';
import { MY_CONTENT } from './packs';
import type { Repository } from './repository';

/** The free D&D 5e API (https://www.dnd5eapi.co): stat blocks and one painted picture per SRD 5.1 monster. */
export const DND5E_API = 'https://www.dnd5eapi.co';

const listSchema = z.object({ results: z.array(z.object({ index: z.string(), name: z.string() })) });

// The API's PNGs are about 1.7 MB each; tokens and previews never need more.
const MAX_SIDE = 768;
const PARALLEL_DOWNLOADS = 4;
// The API answers 429 beyond 100 requests a second per address (Retry-After
// 1); CORS hides that header from the app, so the pause is fixed.
const RATE_LIMIT_PAUSE_MS = 1000;

/** GET `path` (e.g. `/api/2014/spells`) of the API, waiting out its rate limit; the caller judges the status. */
export async function fetchApi(path: string, signal?: AbortSignal): Promise<Response> {
  let response = await fetch(`${DND5E_API}${path}`, { signal });
  while (response.status === 429) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, RATE_LIMIT_PAUSE_MS);
    await promise;
    response = await fetch(`${DND5E_API}${path}`, { signal });
  }
  return response;
}

export async function fetchApiJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchApi(path, signal);
  if (!response.ok) {
    throw new Error(`D&D 5e API download failed (HTTP ${response.status}): ${DND5E_API}${path}`);
  }
  return response.json();
}

/** Index and name of everything in an API list (`monsters`, `spells`, `magic-items`, `equipment`). */
export async function listApi(endpoint: string, signal?: AbortSignal): Promise<{ index: string; name: string }[]> {
  return listSchema.parse(await fetchApiJson(`/api/2014/${endpoint}`, signal)).results;
}

/**
 * Runs `work` on every item, `PARALLEL_DOWNLOADS` at a time. The first failure or an abort of `signal` stops
 * the others taking further items.
 */
export async function inParallel<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      try {
        signal?.throwIfAborted();
        await work(next);
      } catch (error) {
        queue.length = 0;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
}

// The API import names SRD creatures `srd-<monster index>`; naming the
// files that way matches them by id, also forms like "Werewolf, Human Form".
const SRD_PREFIX = 'srd-';

/** Picture file names the API offers, `srd-<monster index>.png`, ready for `matchPortraits`. */
export async function listApiPictures(): Promise<string[]> {
  return (await listApi('monsters')).map((monster) => `${SRD_PREFIX}${monster.index}.png`);
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
 * Downloads each picture, shrinks it to a JPEG and stores it as the creature's image in `pack` (My content,
 * which pictures pack creatures too, by default). Returns the creatures the API has no picture for.
 */
export async function downloadApiPictures(
  repository: Repository,
  plan: readonly ApiPicture[],
  onProgress: (done: number) => void,
  { pack = MY_CONTENT, signal }: { pack?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
  const missing: string[] = [];
  let done = 0;
  await inParallel(
    plan,
    async (next) => {
      const file = next.fileName.slice(SRD_PREFIX.length);
      const response = await fetchApi(`/api/images/monsters/${file}`, signal);
      if (response.status === 404) {
        missing.push(next.creatureId);
      } else if (!response.ok) {
        throw new Error(`D&D 5e API download failed (HTTP ${response.status}): ${next.fileName}`);
      } else {
        const jpeg = await shrinkToJpeg(await response.blob());
        await repository.importCreaturePicture(next.creatureId, 'image', `${next.creatureId}.jpg`, jpeg, pack);
      }
      done += 1;
      onProgress(done);
    },
    signal,
  );
  return missing;
}
