import { musicPosition } from '@/core/atmosphere/playlist';
import { currentTrack, onSoundEffect, useSoundStore } from '@/sound/soundStore';
import { useInterludeStore } from '@/sound/interlude';
import { useAppStore } from '@/state/appStore';
import { useCalendarStore } from '@/state/calendarStore';
import { useEncounterStore } from '@/state/encounterStore';
import { currentDmScene } from '@/state/scene';
import type { DmTransport, SyncPayload } from './protocol';

function audioPayload(nowMs: number): SyncPayload {
  const sound = useSoundStore.getState();
  const track = currentTrack(sound);
  const music = track && {
    asset: track.asset,
    positionSec: musicPosition(sound.music, nowMs),
    playing: sound.music.playing,
  };
  return { type: 'audio', audio: { music, volume: useAppStore.getState().settings?.audio.volume ?? 1 } };
}

function interludePayload(nowMs: number): SyncPayload {
  const { interlude } = useInterludeStore.getState();
  return {
    type: 'interlude',
    interlude: interlude && { asset: interlude.asset, positionSec: (nowMs - interlude.startedAtMs) / 1000 },
  };
}

// Positions advance with the clock; only what the receivers cannot derive
// from the last message counts as a change.
function audioKey(): string {
  const sound = useSoundStore.getState();
  const { moodId, trackIndex, playing, positionSec, sinceMs } = sound.music;
  const volume = useAppStore.getState().settings?.audio.volume;
  return JSON.stringify([
    currentTrack(sound)?.asset ?? null,
    moodId,
    trackIndex,
    playing,
    positionSec,
    sinceMs,
    volume,
  ]);
}

/**
 * Sends music, sound board effects, time of day, weather and interludes to every player view: they are the
 * same for every view. Changes go out at once, a resend request gets the current state; positions are
 * computed at sending time, so late joiners start where everyone else is.
 */
export function startAtmospherePublisher(transports: DmTransport[]): () => void {
  const viewsOf = new Map<DmTransport, ReadonlySet<string>>();
  const sent = { audio: audioKey(), scene: JSON.stringify(currentDmScene()) };

  const sendAll = (payload: SyncPayload) => {
    for (const transport of transports) {
      transport.send([...(viewsOf.get(transport) ?? [])], payload);
    }
  };

  const publishAudio = () => {
    const key = audioKey();
    if (key !== sent.audio) {
      sent.audio = key;
      sendAll(audioPayload(Date.now()));
    }
  };

  const publishScene = () => {
    const scene = currentDmScene();
    const key = JSON.stringify(scene);
    if (key !== sent.scene) {
      sent.scene = key;
      sendAll({ type: 'scene', scene });
    }
  };

  const resend = (transport: DmTransport, view: string | null) => {
    const views = view === null ? [...(viewsOf.get(transport) ?? [])] : [view];
    const now = Date.now();
    transport.send(views, audioPayload(now));
    transport.send(views, { type: 'scene', scene: currentDmScene() });
    transport.send(views, interludePayload(now));
  };

  const unsubscribers = [
    ...transports.map((transport) => transport.watchViews((views) => viewsOf.set(transport, views))),
    ...transports.map((transport) => transport.onResend((view) => resend(transport, view))),
    useSoundStore.subscribe(publishAudio),
    useAppStore.subscribe((state, previous) => {
      if (state.settings?.audio !== previous.settings?.audio) publishAudio();
    }),
    useEncounterStore.subscribe(publishScene),
    useCalendarStore.subscribe(publishScene),
    useInterludeStore.subscribe(() => sendAll(interludePayload(Date.now()))),
    onSoundEffect((asset, volume) => sendAll({ type: 'sfx', asset, volume })),
  ];
  const now = Date.now();
  sendAll(audioPayload(now));
  sendAll({ type: 'scene', scene: currentDmScene() });
  sendAll(interludePayload(now));

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
