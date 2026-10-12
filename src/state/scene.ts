import { useMemo } from 'react';
import { sceneMinute } from '@/core/atmosphere/timeOfDay';
import { minuteOfDay, type Calendar } from '@/core/campaign/calendar';
import type { Atmosphere } from '@/core/model';
import type { PlayerScene } from '@/sync/protocol';
import { useCalendarStore } from './calendarStore';
import { useEncounterStore } from './encounterStore';

/** Time of day and weather of a scene; null without an encounter. */
export function dmScene(atmosphere: Atmosphere | null, calendar: Calendar | null): PlayerScene | null {
  return (
    atmosphere && {
      minute: sceneMinute(atmosphere, calendar ? minuteOfDay(calendar) : null),
      weather: atmosphere.weather,
    }
  );
}

/** The running encounter's scene now. */
export function currentDmScene(): PlayerScene | null {
  return dmScene(useEncounterStore.getState().encounter?.atmosphere ?? null, useCalendarStore.getState().calendar);
}

export function useDmScene(): PlayerScene | null {
  const atmosphere = useEncounterStore((s) => s.encounter?.atmosphere ?? null);
  const calendar = useCalendarStore((s) => s.calendar);
  return useMemo(() => dmScene(atmosphere, calendar), [atmosphere, calendar]);
}
