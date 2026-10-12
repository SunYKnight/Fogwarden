import { ambientListeners, ambientVoices } from '@/core/atmosphere/ambient';
import { activeMood, followMood, musicPosition } from '@/core/atmosphere/playlist';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { AudioOutput } from './audioOutput';
import { currentTrack, onSoundEffect, reloadSounds, skipTrack, useSoundStore } from './soundStore';

/**
 * Runs the DM window's sound: loads the sound library (again when the data root or the packs change), lets
 * the music follow the running encounter's mood (Start and End combat switch it), plays it with effects and
 * the party's ambience at the master volume times the DM window's own volume. Returns the stop function.
 */
export function startDmSound(): () => void {
  const reportError = (error: unknown) => useAppStore.getState().reportError(error);
  const output = new AudioOutput({
    resolve: (ref) => useAppStore.getState().repository.storage.assetUrl(ref),
    onBlocked: () => reportError(new Error('The window blocked sound; press Play in the Sound menu')),
    onError: reportError,
    onTrackEnded: skipTrack,
  });

  const followScene = () => {
    const encounter = useEncounterStore.getState().encounter;
    const mood = encounter ? activeMood(encounter.atmosphere, encounter.round > 0) : null;
    const { music } = useSoundStore.getState();
    const next = followMood(music, mood, Date.now());
    if (next !== music) useSoundStore.setState({ music: next });
  };

  const playMusic = () => {
    const sound = useSoundStore.getState();
    const track = currentTrack(sound);
    output.setMusic(track?.asset ?? null, musicPosition(sound.music, Date.now()), sound.music.playing);
  };

  const playAmbience = () => {
    const { encounter, map } = useEncounterStore.getState();
    const listeners = encounter ? ambientListeners(encounter.combatants, null) : [];
    const voices = map ? ambientVoices(map.regions, listeners) : [];
    output.setAmbient(voices.map(({ id, sound, gain }) => ({ id, asset: sound.asset, gain })));
  };

  const applyVolume = () => {
    const audio = useAppStore.getState().settings?.audio;
    output.setVolume(audio ? audio.volume * audio.dmVolume : 0);
  };

  const unsubscribers = [
    useEncounterStore.subscribe(() => {
      followScene();
      playAmbience();
    }),
    useSoundStore.subscribe(playMusic),
    useAppStore.subscribe((state, previous) => {
      if (state.settings?.audio !== previous.settings?.audio) applyVolume();
      if (state.repository !== previous.repository || state.settings?.packs !== previous.settings?.packs) {
        reloadSounds().catch(reportError);
      }
    }),
    onSoundEffect((asset, volume) => output.playEffect(asset, volume)),
  ];
  applyVolume();
  reloadSounds().catch(reportError);
  followScene();
  playMusic();
  playAmbience();

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    output.dispose();
  };
}
