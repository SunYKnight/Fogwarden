import { describe, expect, it } from 'vitest';
import { defaultAtmosphere } from '../model';
import {
  activeMood,
  chooseMood,
  crossfadeGains,
  followMood,
  musicPosition,
  nextTrack,
  setPlaying,
  SILENCE,
} from './playlist';

describe('moods', () => {
  const atmosphere = { ...defaultAtmosphere(), mood: 'tavern', combatMood: 'boss' };

  it('switches to the combat mood during combat and back after it', () => {
    expect(activeMood(atmosphere, false)).toBe('tavern');
    expect(activeMood(atmosphere, true)).toBe('boss');
  });

  it('keeps the music in combat when the encounter has no combat mood', () => {
    expect(activeMood({ ...atmosphere, combatMood: null }, true)).toBe('tavern');
  });

  it('lets a mood button change the mood of the current phase only', () => {
    expect(chooseMood(atmosphere, false, 'exploration')).toMatchObject({ mood: 'exploration', combatMood: 'boss' });
    expect(chooseMood(atmosphere, true, 'combat')).toMatchObject({ mood: 'tavern', combatMood: 'combat' });
    expect(chooseMood({ ...atmosphere, combatMood: null }, true, 'combat')).toMatchObject({ mood: 'combat' });
  });
});

describe('music state', () => {
  it('starts the first track of a new mood and keeps playing the same mood', () => {
    const tavern = followMood(SILENCE, 'tavern', 1000);
    expect(tavern).toEqual({ moodId: 'tavern', trackIndex: 0, playing: true, positionSec: 0, sinceMs: 1000 });
    const later = nextTrack(tavern, 3, 5000);
    expect(followMood(later, 'tavern', 9000)).toBe(later);
    expect(followMood(later, null, 9000).playing).toBe(false);
  });

  it('advances the position with the clock only while playing', () => {
    const playing = followMood(SILENCE, 'combat', 1000);
    expect(musicPosition(playing, 4000)).toBe(3);
    const paused = setPlaying(playing, false, 4000);
    expect(musicPosition(paused, 60_000)).toBe(3);
    const resumed = setPlaying(paused, true, 60_000);
    expect(musicPosition(resumed, 62_000)).toBe(5);
  });

  it('wraps to the first track after the last', () => {
    let state = followMood(SILENCE, 'boss', 0);
    state = nextTrack(state, 2, 1);
    expect(state.trackIndex).toBe(1);
    state = nextTrack(state, 2, 2);
    expect(state).toMatchObject({ trackIndex: 0, positionSec: 0, sinceMs: 2, playing: true });
  });

  it('crossfades with constant power', () => {
    expect(crossfadeGains(0)).toEqual({ out: 1, in: 0 });
    const mid = crossfadeGains(0.5);
    expect(mid.out ** 2 + mid.in ** 2).toBeCloseTo(1);
    expect(crossfadeGains(2).in).toBe(1);
  });
});
