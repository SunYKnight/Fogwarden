import { create } from 'zustand';
import { chooseMood, nextTrack, setPlaying, SILENCE, type MusicState } from '@/core/atmosphere/playlist';
import {
  emptySoundLibrary,
  mergeSoundLibraries,
  type LoadedEffect,
  type SoundLibrary,
  type SoundEffect,
  type SoundLibraryFile,
  type Track,
} from '@/core/atmosphere/soundLibrary';
import { freeDocumentId } from '@/core/import/ids';
import type { AssetRef } from '@/core/model';
import { importSoundFile, loadSounds, saveMySounds } from '@/data/soundFiles';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';

interface SoundState {
  /** Moods and effects of every sound folder. */
  library: SoundLibrary;
  /** The user's own `sounds.json`, the only one the app edits. */
  mine: SoundLibraryFile;
  music: MusicState;
}

/** The DM's sound library and music; the scene's moods live in `encounter.atmosphere`. */
export const useSoundStore = create<SoundState>(() => ({
  library: mergeSoundLibraries([]),
  mine: emptySoundLibrary(),
  music: SILENCE,
}));

type EffectListener = (asset: AssetRef, volume: number) => void;
const effectListeners = new Set<EffectListener>();

/** Calls `listener` for every sound board effect the DM plays; returns the unsubscribe function. */
export function onSoundEffect(listener: EffectListener): () => void {
  effectListeners.add(listener);
  return () => effectListeners.delete(listener);
}

export function currentTrack(state: Pick<SoundState, 'library' | 'music'>): Track | null {
  const mood = state.library.moods.find((m) => m.id === state.music.moodId);
  return mood?.tracks[state.music.trackIndex] ?? null;
}

export async function reloadSounds(): Promise<void> {
  const { library, mine } = await loadSounds(useAppStore.getState().repository);
  useSoundStore.setState({ library, mine });
}

async function editMySounds(recipe: (file: SoundLibraryFile) => SoundLibraryFile): Promise<void> {
  await saveMySounds(useAppStore.getState().repository, recipe(useSoundStore.getState().mine));
  await reloadSounds();
}

/** Plays `moodId` in the current phase (combat or not) of the running encounter; undoable. */
export function selectMood(moodId: string | null): void {
  const { update } = useEncounterStore.getState();
  update((draft) => {
    draft.atmosphere = chooseMood(draft.atmosphere, draft.round > 0, moodId);
  }, 'Change mood');
}

export function setCombatMood(moodId: string | null): void {
  useEncounterStore.getState().update((draft) => void (draft.atmosphere.combatMood = moodId), 'Combat mood');
}

export function togglePlaying(): void {
  const { music } = useSoundStore.getState();
  useSoundStore.setState({ music: setPlaying(music, !music.playing, Date.now()) });
}

export function skipTrack(): void {
  const { music, library } = useSoundStore.getState();
  const count = library.moods.find((m) => m.id === music.moodId)?.tracks.length ?? 0;
  useSoundStore.setState({ music: nextTrack(music, count, Date.now()) });
}

export function playEffect(effect: LoadedEffect): void {
  for (const listener of effectListeners) {
    listener(effect.asset, effect.volume);
  }
}

/** Copies audio files into the sound folder and appends them to a mood (created when it is a default one). */
export async function addTracks(moodId: string, files: readonly File[]): Promise<void> {
  const repository = useAppStore.getState().repository;
  const names: string[] = [];
  for (const file of files) {
    names.push(await importSoundFile(repository, file));
  }
  const name = useSoundStore.getState().library.moods.find((m) => m.id === moodId)?.name ?? moodId;
  await editMySounds((mine) => ({
    ...mine,
    moods: mine.moods.some((m) => m.id === moodId)
      ? mine.moods.map((m) => (m.id === moodId ? { ...m, tracks: [...m.tracks, ...names] } : m))
      : [...mine.moods, { id: moodId, name, tracks: names }],
  }));
}

/** Takes a track out of a mood; the audio file stays in the sound folder. */
export function removeTrack(moodId: string, track: string): Promise<void> {
  return editMySounds((mine) => ({
    ...mine,
    moods: mine.moods.map((m) => (m.id === moodId ? { ...m, tracks: m.tracks.filter((t) => t !== track) } : m)),
  }));
}

export async function addMood(name: string): Promise<string> {
  const taken = new Set(useSoundStore.getState().library.moods.map((m) => m.id));
  const id = freeDocumentId(name, 'mood', taken);
  await editMySounds((mine) => ({ ...mine, moods: [...mine.moods, { id, name, tracks: [] }] }));
  return id;
}

export async function addEffects(files: readonly File[]): Promise<void> {
  const repository = useAppStore.getState().repository;
  const taken = new Set(useSoundStore.getState().library.effects.map((e) => e.id));
  const effects: SoundEffect[] = [];
  for (const file of files) {
    const fileName = await importSoundFile(repository, file);
    const name = file.name.replace(/\.[^.]*$/, '');
    const id = freeDocumentId(name, 'effect', taken);
    taken.add(id);
    effects.push({ id, name, file: fileName, volume: 1 });
  }
  await editMySounds((mine) => ({ ...mine, effects: [...mine.effects, ...effects] }));
}

/** Takes an effect off the sound board; the audio file stays in the sound folder. */
export function removeEffect(id: string): Promise<void> {
  return editMySounds((mine) => ({ ...mine, effects: mine.effects.filter((e) => e.id !== id) }));
}
