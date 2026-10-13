import type { BattleMap, Campaign, DocRef, Encounter, EncounterLocator } from '@/core/model';

export interface MapEntry {
  ref: DocRef;
  doc: BattleMap;
}

/** The `limit` most recently changed maps, newest first. */
export function recentMaps(maps: readonly MapEntry[], limit: number): MapEntry[] {
  return [...maps].sort((a, b) => b.doc.updatedAt.localeCompare(a.doc.updatedAt)).slice(0, limit);
}

/**
 * The campaign Home shows: the DM's pick, else the one of the last played encounter, else the most recently active
 * one (its own last change or that of one of its encounters). Ids of deleted campaigns are skipped.
 */
export function homeCampaignId(
  campaigns: readonly Campaign[],
  encounters: readonly Encounter[],
  picked: string | null,
  last: EncounterLocator | null,
): string | null {
  const activity = (campaign: Campaign) =>
    encounters
      .filter((e) => e.campaignId === campaign.id)
      .reduce((latest, e) => (e.updatedAt > latest ? e.updatedAt : latest), campaign.updatedAt);
  const newest = [...campaigns].sort((a, b) => activity(b).localeCompare(activity(a)))[0]?.id ?? null;
  const wanted = [picked, last?.campaignId ?? null].find((id) => campaigns.some((c) => c.id === id));
  return wanted ?? newest;
}
