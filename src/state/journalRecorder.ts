import {
  appendTimeline,
  currentSession,
  newJournalEntry,
  notableEvents,
  type JournalEntry,
} from '@/core/campaign/journal';
import { CampaignFiles, JOURNAL } from '@/data/campaignFiles';
import { useAppStore } from './appStore';
import { useEncounterStore } from './encounterStore';

// Appends run one after another, so two events never read the same file
// version and the second write drops the first one's lines.
let writes: Promise<unknown> = Promise.resolve();

/**
 * Adds timeline lines (prefixed with the time of day) to the campaign's current session entry, creating the
 * next session's entry when there is none from today, and links `encounterId` to it.
 */
export function appendToJournal(
  campaignId: string,
  lines: string[],
  encounterId: string | null,
): Promise<JournalEntry> {
  const run = writes.then(async () => {
    const files = new CampaignFiles(useAppStore.getState().repository.storage, campaignId);
    const { docs } = await files.list(JOURNAL);
    const now = new Date();
    const current = currentSession(docs, now);
    const created = current ? null : newJournalEntry(docs, now);
    const entry = current ?? { ...created!, id: await files.newId(JOURNAL, created!.id) };
    // The journal is a document: one 24-hour format whatever the system locale.
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const linked = encounterId === null || entry.encounters.includes(encounterId);
    const saved = await files.save(JOURNAL, {
      ...entry,
      encounters: linked ? entry.encounters : [...entry.encounters, encounterId],
      body: appendTimeline(
        entry.body,
        lines.map((l) => `- ${time} ${l}`),
      ),
    });
    if (created) {
      useAppStore.getState().notify(`Journal: started "${saved.title}"`, 'info');
    }
    return saved;
  });
  // The caller gets the failure through `run`; the queue goes on.
  writes = run.catch(() => undefined);
  return run;
}

/** Writes combat start and end, fallen combatants, XP and loot of the running encounter to the journal. */
export function startJournalRecorder(): () => void {
  let previous = useEncounterStore.getState().encounter;
  return useEncounterStore.subscribe(({ encounter }) => {
    const before = previous;
    previous = encounter;
    const same = before && encounter && before !== encounter && before.id === encounter.id;
    const events = same && before.campaignId === encounter.campaignId ? notableEvents(before, encounter) : [];
    if (encounter && events.length > 0) {
      const lines = events.map((e) => `${encounter.name}: ${e}`);
      appendToJournal(encounter.campaignId, lines, encounter.id).catch(useAppStore.getState().reportError);
    }
  });
}
