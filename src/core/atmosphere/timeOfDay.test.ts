import { describe, expect, it } from 'vitest';
import { defaultAtmosphere } from '../model';
import { dayPhase, daylight, formatMinute, sceneLightLevel, sceneMinute, skyTint } from './timeOfDay';

describe('time of day', () => {
  it('names the phase of a minute', () => {
    expect(dayPhase(0)).toBe('night');
    expect(dayPhase(6 * 60)).toBe('dawn');
    expect(dayPhase(12 * 60)).toBe('day');
    expect(dayPhase(19 * 60)).toBe('dusk');
    expect(dayPhase(22 * 60)).toBe('night');
  });

  it('ramps daylight through dawn and dusk', () => {
    expect(daylight(3 * 60)).toBe(0);
    expect(daylight(6 * 60)).toBe(0.5);
    expect(daylight(12 * 60)).toBe(1);
    expect(daylight(19 * 60)).toBe(0.5);
    expect(skyTint(12 * 60)).toBe('#ffffff');
    expect(skyTint(0)).not.toBe('#ffffff');
  });

  it('darkens an open map at night but never lightens a dark one', () => {
    expect(sceneLightLevel(null, 'dim')).toBe('dim');
    expect(sceneLightLevel(0, 'bright')).toBe('darkness');
    expect(sceneLightLevel(6 * 60, 'bright')).toBe('dim');
    expect(sceneLightLevel(12 * 60, 'darkness')).toBe('darkness');
    expect(sceneLightLevel(0, 'magical-darkness')).toBe('magical-darkness');
  });

  it('follows the campaign calendar while time of day is on', () => {
    const on = { ...defaultAtmosphere(), minute: 600 };
    expect(sceneMinute(on, null)).toBe(600);
    expect(sceneMinute(on, 1200)).toBe(1200);
    expect(sceneMinute(defaultAtmosphere(), 1200)).toBeNull();
    expect(formatMinute(1205)).toBe('20:05');
  });
});
