import { z } from 'zod';
import { idSchema, type AssetRef, type StorageArea } from '../model';

export const SOUND_LIBRARY_SCHEMA_VERSION = 1;

/** A playlist; `tracks` are file names relative to the `sounds` folder holding the file. */
export const moodSchema = z.object({
  id: idSchema,
  name: z.string(),
  tracks: z.array(z.string().min(1)),
});
export type Mood = z.infer<typeof moodSchema>;

/** Sound board button; `file` is relative to the `sounds` folder, `volume` 0..1 of the master volume. */
export const soundEffectSchema = z.object({
  id: idSchema,
  name: z.string(),
  file: z.string().min(1),
  volume: z.number().min(0).max(1),
});
export type SoundEffect = z.infer<typeof soundEffectSchema>;

/** `sounds/sounds.json`: moods and sound board of one library root. */
export const soundLibraryFileSchema = z.object({
  schema: z.literal('sounds'),
  version: z.number().int().positive(),
  moods: z.array(moodSchema),
  effects: z.array(soundEffectSchema),
});
export type SoundLibraryFile = z.infer<typeof soundLibraryFileSchema>;

export function emptySoundLibrary(): SoundLibraryFile {
  return { schema: 'sounds', version: SOUND_LIBRARY_SCHEMA_VERSION, moods: [], effects: [] };
}

/** Moods every library offers, so Start combat always has a mood to switch to. */
export const DEFAULT_MOODS: readonly Mood[] = [
  { id: 'exploration', name: 'Exploration', tracks: [] },
  { id: 'tavern', name: 'Tavern', tracks: [] },
  { id: 'combat', name: 'Combat', tracks: [] },
  { id: 'boss', name: 'Boss', tracks: [] },
];

export interface Track {
  name: string;
  asset: AssetRef;
  /** Shipped or pack content: listed but not removable. */
  locked: boolean;
}

export interface LoadedMood {
  id: string;
  name: string;
  tracks: Track[];
}

export interface LoadedEffect extends Omit<SoundEffect, 'file'> {
  asset: AssetRef;
  locked: boolean;
}

export interface SoundLibrary {
  moods: LoadedMood[];
  effects: LoadedEffect[];
}

/** One `sounds.json` with the folder it lives in. */
export interface SoundSource {
  area: StorageArea;
  /** Folder of the file, e.g. `library/sounds`; track names resolve against it. */
  dir: string;
  file: SoundLibraryFile;
  locked: boolean;
}

/**
 * Merges the sources in precedence order: moods with the same id join their tracks (a pack adds music to
 * "Tavern"), the first source names them; effects with the same id are taken from the first source. The
 * default moods follow the sources' own moods unless a source defines them.
 */
export function mergeSoundLibraries(sources: readonly SoundSource[]): SoundLibrary {
  const moods = new Map<string, LoadedMood>();
  const effects = new Map<string, LoadedEffect>();
  for (const source of sources) {
    for (const mood of source.file.moods) {
      const merged = moods.get(mood.id) ?? { id: mood.id, name: mood.name, tracks: [] };
      merged.tracks.push(
        ...mood.tracks.map((file) => ({
          name: file,
          asset: { area: source.area, path: `${source.dir}/${file}` },
          locked: source.locked,
        })),
      );
      moods.set(mood.id, merged);
    }
    for (const { file, ...effect } of source.file.effects) {
      if (!effects.has(effect.id)) {
        effects.set(effect.id, {
          ...effect,
          asset: { area: source.area, path: `${source.dir}/${file}` },
          locked: source.locked,
        });
      }
    }
  }
  for (const mood of DEFAULT_MOODS) {
    if (!moods.has(mood.id)) {
      moods.set(mood.id, { id: mood.id, name: mood.name, tracks: [] });
    }
  }
  return { moods: [...moods.values()], effects: [...effects.values()] };
}
