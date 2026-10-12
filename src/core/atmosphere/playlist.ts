import type { Atmosphere } from '../model';

/**
 * The DM's music: which track of which mood, and where it stands. While playing, the position advances with
 * the clock from `positionSec` at `sinceMs`, so no timer has to tick it.
 */
export interface MusicState {
  moodId: string | null;
  trackIndex: number;
  playing: boolean;
  positionSec: number;
  sinceMs: number;
}

export const SILENCE: MusicState = { moodId: null, trackIndex: 0, playing: false, positionSec: 0, sinceMs: 0 };

/** Seconds into the current track at `nowMs`. */
export function musicPosition(state: MusicState, nowMs: number): number {
  return state.positionSec + (state.playing ? Math.max(0, nowMs - state.sinceMs) / 1000 : 0);
}

/** The mood the scene asks for: the combat mood during combat (when set), else the exploration mood. */
export function activeMood(atmosphere: Atmosphere, inCombat: boolean): string | null {
  return inCombat && atmosphere.combatMood !== null ? atmosphere.combatMood : atmosphere.mood;
}

/** Which atmosphere field a mood button sets: the combat mood during combat, else the mood. */
export function chooseMood(atmosphere: Atmosphere, inCombat: boolean, moodId: string | null): Atmosphere {
  return inCombat && atmosphere.combatMood !== null
    ? { ...atmosphere, combatMood: moodId }
    : { ...atmosphere, mood: moodId };
}

/** Follows the scene's mood: a new mood starts its first track, the same mood keeps playing. */
export function followMood(state: MusicState, moodId: string | null, nowMs: number): MusicState {
  return moodId === state.moodId
    ? state
    : { moodId, trackIndex: 0, playing: moodId !== null, positionSec: 0, sinceMs: nowMs };
}

/** Next track of a mood with `trackCount` tracks, wrapping to the first; starts playing. */
export function nextTrack(state: MusicState, trackCount: number, nowMs: number): MusicState {
  return {
    ...state,
    trackIndex: trackCount === 0 ? 0 : (state.trackIndex + 1) % trackCount,
    playing: trackCount > 0,
    positionSec: 0,
    sinceMs: nowMs,
  };
}

export function setPlaying(state: MusicState, playing: boolean, nowMs: number): MusicState {
  return playing === state.playing
    ? state
    : { ...state, playing, positionSec: musicPosition(state, nowMs), sinceMs: nowMs };
}

/** Gains of the fading-out and fading-in track, `t` 0..1 through the crossfade; equal power keeps loudness. */
export function crossfadeGains(t: number): { out: number; in: number } {
  const clamped = Math.min(1, Math.max(0, t));
  return { out: Math.cos((clamped * Math.PI) / 2), in: Math.sin((clamped * Math.PI) / 2) };
}
