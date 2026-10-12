import {
  emptySoundLibrary,
  mergeSoundLibraries,
  soundLibraryFileSchema,
  type SoundLibrary,
  type SoundLibraryFile,
  type SoundSource,
} from '@/core/atmosphere/soundLibrary';
import type { StorageArea } from '@/core/model';
import { MY_CONTENT, MY_CONTENT_SOURCE } from './packs';
import { DataError, type Repository } from './repository';

const SOUNDS_DIR = 'sounds';
/** The data root's sound folder: imported audio files and the user's `sounds.json`. */
export const USER_SOUNDS_DIR = `${MY_CONTENT_SOURCE.root}/${SOUNDS_DIR}`;
const SOUNDS_FILE = 'sounds.json';

async function readSoundFile(repository: Repository, area: StorageArea, dir: string): Promise<SoundLibraryFile> {
  const path = `${dir}/${SOUNDS_FILE}`;
  const text = (await repository.storage.exists(area, path)) ? await repository.storage.readText(area, path) : null;
  let file = emptySoundLibrary();
  try {
    file = text === null ? file : soundLibraryFileSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new DataError(error instanceof Error ? error.message : String(error), area, path);
  }
  return file;
}

/**
 * Moods and sound board of the `sounds` folders of My content and every enabled pack, plus the user's own
 * file for edits; pack entries are locked.
 */
export async function loadSounds(repository: Repository): Promise<{ library: SoundLibrary; mine: SoundLibraryFile }> {
  const librarySources = await repository.librarySources();
  const sources: SoundSource[] = await Promise.all(
    librarySources.map(async ({ pack, area, root }) => ({
      area,
      dir: `${root}/${SOUNDS_DIR}`,
      locked: pack !== MY_CONTENT,
      file: await readSoundFile(repository, area, `${root}/${SOUNDS_DIR}`),
    })),
  );
  const mine = sources.find((s) => s.area === 'data' && s.dir === USER_SOUNDS_DIR)?.file ?? emptySoundLibrary();
  return { library: mergeSoundLibraries(sources), mine };
}

/** Writes the user's `sounds.json`, pretty-printed for hand edits. */
export function saveMySounds(repository: Repository, file: SoundLibraryFile): Promise<void> {
  return repository.storage.writeText(`${USER_SOUNDS_DIR}/${SOUNDS_FILE}`, `${JSON.stringify(file, null, 2)}\n`);
}

/** Copies an audio file into the user's sound folder under a free name; returns that name. */
export async function importSoundFile(repository: Repository, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\- ]+/g, '_');
  const dot = safe.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ''];
  let name = safe;
  for (let n = 2; await repository.storage.exists('data', `${USER_SOUNDS_DIR}/${name}`); n++) {
    name = `${stem}-${n}${extension}`;
  }
  await repository.storage.writeBytes(`${USER_SOUNDS_DIR}/${name}`, new Uint8Array(await file.arrayBuffer()));
  return name;
}
