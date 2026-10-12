import type { Atmosphere, LightLevel } from '../model';

export const MINUTES_PER_DAY = 1440;

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

// Fixed temperate-latitude day: dawn 5-7, day 7-18, dusk 18-20.
const DAWN = 5 * 60;
const DAY = 7 * 60;
const DUSK = 18 * 60;
const NIGHT = 20 * 60;

/** Slider marks of the Scene menu, minute of the day each phase is centred on. */
export const PHASE_MINUTE: Record<DayPhase, number> = { dawn: 6 * 60, day: 12 * 60, dusk: 19 * 60, night: 0 };

const PHASE_LIGHT: Record<DayPhase, LightLevel> = { night: 'darkness', dawn: 'dim', day: 'bright', dusk: 'dim' };

const LIGHT_ORDER: readonly LightLevel[] = ['bright', 'dim', 'darkness', 'magical-darkness'];

export function dayPhase(minute: number): DayPhase {
  const phases: [number, DayPhase][] = [
    [NIGHT, 'night'],
    [DUSK, 'dusk'],
    [DAY, 'day'],
    [DAWN, 'dawn'],
  ];
  return phases.find(([start]) => minute >= start)?.[1] ?? 'night';
}

/** Sunlight 0..1: 0 at night, 1 by day, rising through dawn and falling through dusk. */
export function daylight(minute: number): number {
  const rise = (minute - DAWN) / (DAY - DAWN);
  const set = (NIGHT - minute) / (NIGHT - DUSK);
  return Math.min(1, Math.max(0, Math.min(rise, set)));
}

/**
 * Ambient light level of the scene: without a time of day the map's own; with one the darker of the map's
 * and the daylight's, so a cave stays dark at noon while an open field darkens at night.
 */
export function sceneLightLevel(minute: number | null, mapLevel: LightLevel): LightLevel {
  const phaseLevel = minute === null ? mapLevel : PHASE_LIGHT[dayPhase(minute)];
  return LIGHT_ORDER[Math.max(LIGHT_ORDER.indexOf(mapLevel), LIGHT_ORDER.indexOf(phaseLevel))]!;
}

/** Time of day the scene shows: the campaign calendar's when it has one, else the encounter's own. */
export function sceneMinute(atmosphere: Atmosphere, calendarMinute: number | null): number | null {
  return atmosphere.minute === null ? null : (calendarMinute ?? atmosphere.minute);
}

const NIGHT_TINT = [0x7d, 0x92, 0xd6];
const TWILIGHT_TINT = [0xff, 0xb0, 0x78];
const DAY_TINT = [0xff, 0xff, 0xff];

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i]! - v) * t));
}

/** Light color: moonlight blue at night, warm orange in twilight, white by day. */
export function skyTint(minute: number): string {
  const light = daylight(minute);
  const rgb = light < 0.5 ? mix(NIGHT_TINT, TWILIGHT_TINT, light * 2) : mix(TWILIGHT_TINT, DAY_TINT, light * 2 - 1);
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
