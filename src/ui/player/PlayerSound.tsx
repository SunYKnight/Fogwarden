import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ambientListeners, ambientVoices } from '@/core/atmosphere/ambient';
import { AudioOutput } from '@/sound/audioOutput';
import { useAppStore } from '@/state/appStore';
import { Icon } from '../kit';
import { usePlayerStore } from './playerStore';

// The player's own volume belongs to the device, not to the DM's data.
const VOLUME_KEY = 'fogwarden.playerVolume';

function storedVolume(): number {
  const stored = Number(window.localStorage.getItem(VOLUME_KEY) ?? '1');
  return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 1;
}

/** This device's own volume 0..1, kept in the browser. */
export const usePlayerVolume = create<{ volume: number }>(() => ({ volume: storedVolume() }));

/** "Tap to enable sound": the browser refused to start sound before the player touched the page. */
export const useSoundBlocked = create<{ blocked: boolean }>(() => ({ blocked: false }));

/**
 * Plays what the DM sends (music, effects, the ambience heard from this view's characters) at the DM's
 * master volume times this device's own; offers "Tap to enable sound" once when the browser blocks autoplay.
 */
export function PlayerSound() {
  const audio = usePlayerStore((s) => s.audio);
  const effect = usePlayerStore((s) => s.effect);
  const map = usePlayerStore((s) => s.map);
  const encounter = usePlayerStore((s) => s.encounter);
  const viewer = usePlayerStore((s) => s.viewCombatantId);
  const volume = usePlayerVolume((s) => s.volume);
  const blocked = useSoundBlocked((s) => s.blocked);
  const [output, setOutput] = useState<AudioOutput | null>(null);

  useEffect(() => {
    const created = new AudioOutput({
      resolve: (ref) => useAppStore.getState().repository.storage.assetUrl(ref),
      onBlocked: () => useSoundBlocked.setState({ blocked: true }),
      onError: (error) => useAppStore.getState().reportError(error),
    });
    setOutput(created);
    return () => created.dispose();
  }, []);

  useEffect(() => output?.setVolume((audio?.value.volume ?? 1) * volume), [output, audio, volume]);

  useEffect(() => {
    const music = audio?.value.music ?? null;
    const elapsed = music?.playing && audio ? (Date.now() - audio.atMs) / 1000 : 0;
    output?.setMusic(music?.asset ?? null, (music?.positionSec ?? 0) + elapsed, music?.playing ?? false);
  }, [output, audio]);

  useEffect(() => {
    if (effect) output?.playEffect(effect.asset, effect.volume);
  }, [output, effect]);

  useEffect(() => {
    const listeners = encounter ? ambientListeners(encounter.combatants, viewer) : [];
    const voices = map ? ambientVoices(map.regions, listeners) : [];
    output?.setAmbient(voices.map(({ id, sound, gain }) => ({ id, asset: sound.asset, gain })));
  }, [output, map, encounter, viewer]);

  return (
    <div className="player-sound">
      {blocked && (
        <button
          type="button"
          className="sound-unlock"
          onClick={() => {
            output?.unlock();
            useSoundBlocked.setState({ blocked: false });
          }}
        >
          <Icon name="volume" /> Tap to enable sound
        </button>
      )}
      <label className="player-volume" title="Your volume">
        <Icon name={volume === 0 ? 'volumeOff' : 'volume'} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Your volume"
          onChange={(e) => {
            const next = Number(e.target.value);
            window.localStorage.setItem(VOLUME_KEY, String(next));
            usePlayerVolume.setState({ volume: next });
          }}
        />
      </label>
    </div>
  );
}
