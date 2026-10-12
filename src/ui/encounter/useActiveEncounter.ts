import { useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { flushEncounter } from '@/state/autosave';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';

// A late load must not replace a newer encounter, and a switch waits for the
// previous encounter's last save before the store moves on.
let session = 0;
let flushing: Promise<void> = Promise.resolve();

async function loadActive(current: number, campaignId: string | null, encounterId: string | null): Promise<void> {
  const { repository, reportError } = useAppStore.getState();
  await flushing;
  if (campaignId === null || encounterId === null) {
    if (current === session) useEncounterStore.getState().close();
  } else {
    // Stat blocks, spawning and marker templates read the library listings.
    useLibraryStore.getState().refreshAll().catch(reportError);
    const encounter = await repository.loadEncounter(campaignId, encounterId);
    // A missing map (deleted, or in a disabled pack: the error says which)
    // is reported; the encounter still runs as a tracker.
    const map = encounter.map
      ? await repository.load('map', encounter.map).catch((error: unknown) => {
          reportError(error);
          return null;
        })
      : null;
    if (current === session) useEncounterStore.getState().open(encounter, map);
  }
}

/** Loads the Play screen's encounter again from its files, e.g. after a restore replaced them. */
export function reloadActiveEncounter(): Promise<void> {
  const active = useAppStore.getState().settings?.lastEncounter;
  return loadActive(++session, active?.campaignId ?? null, active?.encounterId ?? null);
}

/**
 * Keeps the Play screen's encounter (`settings.lastEncounter`) loaded on every page: players keep their map
 * and the publisher keeps running while the DM looks something up in the Compendium or edits a map.
 */
export function useActiveEncounter(): void {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const campaignId = useAppStore((s) => s.settings?.lastEncounter?.campaignId ?? null);
  const encounterId = useAppStore((s) => s.settings?.lastEncounter?.encounterId ?? null);

  useEffect(() => {
    loadActive(++session, campaignId, encounterId).catch(reportError);
    return () => {
      flushing = flushEncounter().catch(reportError);
    };
  }, [campaignId, encounterId, repository, reportError]);
}
