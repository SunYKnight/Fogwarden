import type { CharacterSession, Encounter } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { hitDiceAfterLongRest, longRest, sessionOf } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { findCreature } from '@/ui/encounter/creatureLookup';
import { readPlayerSheet, updatePlayerSheet } from './playerData';

/** A fight's clicks in quick succession write each file once. */
export const SESSION_WRITE_DELAY_MS = 1000;

// Session state per campaign and view still to write; the newest wins.
const due = new Map<string, { campaignId: string; view: string; session: CharacterSession }>();
let cancelTimer: () => void = () => undefined;

/** Party members (view = member id) whose hit points, slots or death saves differ from `before`'s. */
export function changedSessions(before: Encounter, after: Encounter): { view: string; session: CharacterSession }[] {
  return after.combatants.flatMap((c) => {
    const old = c.partyMemberId === undefined ? undefined : before.combatants.find((b) => b.id === c.id);
    const session = sessionOf(c);
    // A reloaded copy of the same encounter holds new objects, same values.
    const changed = old !== undefined && old !== c && JSON.stringify(sessionOf(old)) !== JSON.stringify(session);
    return changed ? [{ view: c.id, session }] : [];
  });
}

/** Writes the session states still due now; resolves once they are in the files. */
export async function flushPartySessions(): Promise<void> {
  cancelTimer();
  const batch = [...due.values()];
  due.clear();
  await Promise.all(
    batch.map(({ campaignId, view, session }) =>
      updatePlayerSheet(campaignId, view, (overlay) => ({ ...overlay, session })),
    ),
  );
}

/**
 * Keeps each party member's session state in its campaign's player sheet file: every change of hit points,
 * temporary hit points, spell slots or death saves in the open encounter, by the DM or a player, is written a
 * moment later, and at once when the encounter closes or another one opens.
 */
export function startPartySessions(): () => void {
  let previous = useEncounterStore.getState().encounter;
  const flush = () => flushPartySessions().catch(useAppStore.getState().reportError);
  const unsubscribe = useEncounterStore.subscribe(({ encounter }) => {
    const before = previous;
    previous = encounter;
    const same = before && encounter && before.id === encounter.id && before.campaignId === encounter.campaignId;
    const changed = same && before !== encounter ? changedSessions(before, encounter) : [];
    for (const { view, session } of changed) {
      due.set(`${encounter!.campaignId}/${view}`, { campaignId: encounter!.campaignId, view, session });
    }
    if (before && !same) {
      void flush();
    } else if (changed.length > 0) {
      cancelTimer();
      const timer = setTimeout(flush, SESSION_WRITE_DELAY_MS);
      cancelTimer = () => clearTimeout(timer);
    }
  });
  return () => {
    unsubscribe();
    void flush();
  };
}

/** Each view's session state once due writes landed; null for a rested character. */
export async function partySessions(
  campaignId: string,
  views: readonly string[],
): Promise<Record<string, CharacterSession | null>> {
  await flushPartySessions();
  const sheets = await Promise.all(views.map((view) => readPlayerSheet(campaignId, view)));
  return Object.fromEntries(views.map((view, i) => [view, sheets[i]!.session]));
}

/**
 * A long rest of the campaign's party: full hit points, no temporary ones, every slot back, death saves cleared
 * and half the hit dice back (5e). The open encounter of the campaign rests as one undo step, so its next change
 * does not write the old values back. Returns how many members rested.
 */
export async function longRestParty(campaignId: string): Promise<number> {
  const { campaigns } = await useAppStore.getState().repository.listCampaigns();
  const party = campaigns.find((c) => c.id === campaignId)?.party ?? [];
  const members = new Set(party.map((m) => m.id));
  const { encounter, update } = useEncounterStore.getState();
  if (encounter?.campaignId === campaignId && encounter.combatants.some((c) => members.has(c.id))) {
    update((d) => {
      for (const c of d.combatants.filter((each) => members.has(each.id))) {
        longRest(c);
      }
    }, 'Long rest');
  }
  // The encounter's rest is due for writing; the files' rest comes after.
  await flushPartySessions();
  await Promise.all(
    party.map((member) => {
      const level = findCreature(member.creature)?.level ?? null;
      return updatePlayerSheet(campaignId, member.id, (overlay) => ({
        ...overlay,
        session: null,
        hitDiceUsed: hitDiceAfterLongRest(overlay.hitDiceUsed, level),
      }));
    }),
  );
  return party.length;
}
