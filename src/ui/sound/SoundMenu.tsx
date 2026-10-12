import { useRef, useState } from 'react';
import { AUDIO_ACCEPT, mediaTitle } from '@/core/atmosphere/media';
import { activeMood } from '@/core/atmosphere/playlist';
import type { AudioSettings } from '@/core/model';
import {
  addEffects,
  addMood,
  addTracks,
  currentTrack,
  playEffect,
  removeEffect,
  removeTrack,
  selectMood,
  setCombatMood,
  skipTrack,
  togglePlaying,
  useSoundStore,
} from '@/sound/soundStore';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { CheckboxField, SelectField, SliderField } from '../components/fields';
import { Button, Popover, ToolButton } from '../kit';

const KEEP_MUSIC = '';

/** Hidden multi-file audio input opened by a button; hands the picked files to `onFiles`. */
function AudioPicker({ label, onFiles }: { label: string; onFiles: (files: File[]) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button icon="plus" label={busy ? 'Copying…' : label} disabled={busy} onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) {
            setBusy(true);
            onFiles(files)
              .catch(useAppStore.getState().reportError)
              .finally(() => setBusy(false));
          }
        }}
      />
    </>
  );
}

function NewMoodField() {
  const [name, setName] = useState<string | null>(null);
  const reportError = useAppStore((s) => s.reportError);
  const create = () => {
    const trimmed = name?.trim() ?? '';
    if (trimmed !== '') {
      addMood(trimmed)
        .then((id) => {
          selectMood(id);
          useAppStore.getState().notify(`Mood "${trimmed}" added`);
        })
        .catch(reportError);
    }
    setName(null);
  };
  return name === null ? (
    <Button icon="plus" label="New mood" variant="ghost" onClick={() => setName('')} />
  ) : (
    <span className="row">
      <input
        className="sound-new-mood"
        value={name}
        placeholder="Mood name"
        aria-label="New mood name"
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
          if (e.key === 'Escape') setName(null);
        }}
      />
      <Button icon="check" label="Add mood" iconOnly onClick={create} />
    </span>
  );
}

/** Tracks of the playing mood with remove buttons; shipped tracks are locked. */
function TrackList({ moodId }: { moodId: string }) {
  const mood = useSoundStore((s) => s.library.moods.find((m) => m.id === moodId));
  const reportError = useAppStore((s) => s.reportError);
  return mood && mood.tracks.length > 0 ? (
    <ul className="sound-tracks">
      {mood.tracks.map((track) => (
        <li key={`${track.asset.area}:${track.asset.path}`} className="row">
          <span className="sound-track-name">{mediaTitle(track.name)}</span>
          <div className="spacer" />
          {track.locked ? (
            <span className="muted small">shipped</span>
          ) : (
            <Button
              icon="close"
              label={`Remove ${mediaTitle(track.name)} from ${mood.name}`}
              iconOnly
              variant="ghost"
              onClick={() => removeTrack(moodId, track.name).catch(reportError)}
            />
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted small">No music in {mood?.name ?? 'this mood'} yet: add MP3, OGG, WAV or M4A files.</p>
  );
}

function SoundBoard() {
  const effects = useSoundStore((s) => s.library.effects);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div className="row">
        <strong>Sound board</strong>
        <div className="spacer" />
        {effects.length > 0 && (
          <Button icon="edit" label="Edit" variant="ghost" active={editing} onClick={() => setEditing(!editing)} />
        )}
        <AudioPicker
          label="Add sounds"
          onFiles={async (files) => {
            await addEffects(files);
            notify(files.length === 1 ? `Added ${files[0]!.name}` : `Added ${files.length} sounds`);
          }}
        />
      </div>
      {effects.length === 0 ? (
        <p className="muted small">One-shot sounds everyone hears: a door, thunder, a roar.</p>
      ) : (
        <div className="sound-board" role="group" aria-label="Sound board">
          {effects.map((effect) =>
            editing && !effect.locked ? (
              <Button
                key={effect.id}
                icon="trash"
                label={effect.name}
                variant="danger"
                title={`Remove ${effect.name} from the sound board`}
                onClick={() => removeEffect(effect.id).catch(reportError)}
              />
            ) : (
              <Button key={effect.id} icon="volume" label={effect.name} onClick={() => playEffect(effect)} />
            ),
          )}
        </div>
      )}
    </>
  );
}

/** Music by mood, volumes and the sound board; everything plays for the DM and every player view. */
function SoundPanel({ onClose }: { onClose: () => void }) {
  const atmosphere = useEncounterStore((s) => s.encounter?.atmosphere);
  const inCombat = useEncounterStore((s) => (s.encounter?.round ?? 0) > 0);
  const moods = useSoundStore((s) => s.library.moods);
  const music = useSoundStore((s) => s.music);
  const track = useSoundStore(currentTrack);
  const audio = useAppStore((s) => s.settings?.audio);
  const reportError = useAppStore((s) => s.reportError);
  const playing = atmosphere ? activeMood(atmosphere, inCombat) : null;
  const playingName = moods.find((m) => m.id === playing)?.name;
  const setAudio = (patch: Partial<AudioSettings>) => {
    const { settings, setSettings } = useAppStore.getState();
    if (settings) setSettings({ ...settings, audio: { ...settings.audio, ...patch } }).catch(reportError);
  };

  return (
    <div className="sound-popover">
      <div className="row">
        <strong>Sound</strong>
        <span className="muted sound-now">
          {playingName ? `${playingName} · ${track ? mediaTitle(track.name) : 'no music'}` : 'Silence'}
        </span>
        <div className="spacer" />
        <Button icon="close" label="Close sound menu" iconOnly variant="ghost" onClick={onClose} />
      </div>
      <div className="row">
        <Button
          icon={music.playing ? 'pause' : 'play'}
          label={music.playing ? 'Pause' : 'Play'}
          variant="primary"
          disabled={!track}
          onClick={togglePlaying}
        />
        <Button icon="next" label="Next track" disabled={!track} onClick={skipTrack} />
      </div>
      <div className="sound-moods" role="group" aria-label={inCombat ? 'Combat mood' : 'Mood'}>
        {moods.map((mood) => (
          <Button key={mood.id} label={mood.name} active={playing === mood.id} onClick={() => selectMood(mood.id)} />
        ))}
        <Button icon="volumeOff" label="Silence" active={playing === null} onClick={() => selectMood(null)} />
        <NewMoodField />
      </div>
      {atmosphere && (
        <SelectField
          label="In combat"
          value={atmosphere.combatMood ?? KEEP_MUSIC}
          options={[KEEP_MUSIC, ...moods.map((m) => m.id)]}
          format={(id) => (id === KEEP_MUSIC ? 'Keep the music' : (moods.find((m) => m.id === id)?.name ?? id))}
          onChange={(id) => setCombatMood(id === KEEP_MUSIC ? null : id)}
        />
      )}
      {playing && (
        <>
          <div className="row">
            <strong>Tracks of {playingName ?? playing}</strong>
            <div className="spacer" />
            <AudioPicker label="Add music" onFiles={(files) => addTracks(playing, files)} />
          </div>
          <TrackList moodId={playing} />
        </>
      )}
      {audio && (
        <div className="row">
          <SliderField
            label="Volume (everyone)"
            value={Math.round(audio.volume * 100)}
            min={0}
            max={100}
            step={5}
            suffix="%"
            onChange={(percent) => setAudio({ volume: percent / 100 })}
          />
          <CheckboxField
            label="Hear here"
            value={audio.dmVolume > 0}
            onChange={(on) => setAudio({ dmVolume: on ? 1 : 0 })}
          />
        </div>
      )}
      <SoundBoard />
    </div>
  );
}

/** Play canvas toolbar entry: the Sound popover. */
export function SoundMenu() {
  const playing = useSoundStore((s) => s.music.playing && currentTrack(s) !== null);
  return (
    <Popover
      label="Sound"
      trigger={(open, toggle) => <ToolButton icon="music" label="Sound" active={open || playing} onClick={toggle} />}
    >
      {(close) => <SoundPanel onClose={close} />}
    </Popover>
  );
}
