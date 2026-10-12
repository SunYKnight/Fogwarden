import { useEffect } from 'react';
import type { BattleMap, DocRef } from '@/core/model';
import { libraryDocPath, type Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { flushEncounter } from '@/state/autosave';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';

/** A shipped map edited after the encounter was created lives on as a user copy with the same id. */
async function loadEncounterMap(repository: Repository, ref: DocRef): Promise<BattleMap> {
  const edited =
    ref.area === 'content' && (await repository.storage.exists('data', libraryDocPath('map', 'data', ref.id)));
  return repository.load('map', edited ? { area: 'data', id: ref.id } : ref);
}

// A late load must not replace a newer encounter, and a switch waits for the
// previous encounter's last save before the store moves on.
let session = 0;
let flushing: Promise<void> = Promise.resolve();

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
    const current = ++session;
    const load = async () => {
      await flushing;
      if (campaignId === null || encounterId === null) {
        if (current === session) useEncounterStore.getState().close();
      } else {
        // Stat blocks, spawning and marker templates read the library listings.
        useLibraryStore.getState().refreshAll().catch(reportError);
        const encounter = await repository.loadEncounter(campaignId, encounterId);
        // A missing map is reported; the encounter still runs as a tracker.
        const map = encounter.map
          ? await loadEncounterMap(repository, encounter.map).catch((error: unknown) => {
              reportError(error);
              return null;
            })
          : null;
        if (current === session) useEncounterStore.getState().open(encounter, map);
      }
    };
    load().catch(reportError);
    return () => {
      flushing = flushEncounter().catch(reportError);
    };
  }, [campaignId, encounterId, repository, reportError]);
}
