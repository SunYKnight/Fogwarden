import { create } from 'zustand';
import { advanceCalendar, withTimeOfDay, type Calendar } from '@/core/campaign/calendar';
import { CampaignFiles } from '@/data/campaignFiles';
import type { Repository } from '@/data/repository';
import { useAppStore } from './appStore';
import { useEncounterStore } from './encounterStore';

interface CalendarState {
  /** Campaign of the running encounter; null without one. */
  campaignId: string | null;
  /** Its calendar; null while it has none (the Scene's time of day is then free). */
  calendar: Calendar | null;
}

export const useCalendarStore = create<CalendarState>(() => ({ campaignId: null, calendar: null }));

function filesOf(campaignId: string): CampaignFiles {
  return new CampaignFiles(useAppStore.getState().repository.storage, campaignId);
}

/** Writes the calendar; the store follows when it belongs to the running encounter's campaign. */
export async function saveCampaignCalendar(campaignId: string, calendar: Calendar): Promise<Calendar> {
  const saved = await filesOf(campaignId).saveCalendar(calendar);
  if (useCalendarStore.getState().campaignId === campaignId) {
    useCalendarStore.setState({ calendar: saved });
  }
  return saved;
}

function activeCalendar(): { campaignId: string; calendar: Calendar } {
  const { campaignId, calendar } = useCalendarStore.getState();
  if (campaignId === null || calendar === null) {
    throw new Error('The running encounter has no campaign calendar');
  }
  return { campaignId, calendar };
}

/** Sets the running campaign's time on the same in-game day (minutes since midnight). */
export async function setCalendarTimeOfDay(minute: number): Promise<void> {
  const { campaignId, calendar } = activeCalendar();
  await saveCampaignCalendar(campaignId, withTimeOfDay(calendar, minute));
}

/** Moves the running campaign's time forward by `minutes`. */
export async function advanceActiveCalendar(minutes: number): Promise<void> {
  const { campaignId, calendar } = activeCalendar();
  await saveCampaignCalendar(campaignId, advanceCalendar(calendar, minutes));
}

/** Keeps the store on the calendar of the running encounter's campaign; returns the stop function. */
export function startCalendarSync(): () => void {
  let loaded: { campaignId: string | null; repository: Repository | null } = { campaignId: null, repository: null };
  const sync = () => {
    const campaignId = useEncounterStore.getState().encounter?.campaignId ?? null;
    const repository = useAppStore.getState().repository;
    if (campaignId !== loaded.campaignId || repository !== loaded.repository) {
      loaded = { campaignId, repository };
      useCalendarStore.setState({ campaignId, calendar: null });
      if (campaignId !== null) {
        filesOf(campaignId)
          .loadCalendar()
          .then((calendar) => {
            if (useCalendarStore.getState().campaignId === campaignId) {
              useCalendarStore.setState({ calendar });
            }
          })
          .catch(useAppStore.getState().reportError);
      }
    }
  };
  sync();
  const stopEncounter = useEncounterStore.subscribe(sync);
  const stopApp = useAppStore.subscribe(sync);
  return () => {
    stopEncounter();
    stopApp();
  };
}
