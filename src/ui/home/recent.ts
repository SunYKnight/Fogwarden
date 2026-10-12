import type { BattleMap, Campaign, DocRef, Encounter } from '@/core/model';

export type RecentItem =
  | { kind: 'map'; ref: DocRef; map: BattleMap; updatedAt: string }
  | { kind: 'encounter'; campaign: Campaign; encounter: Encounter; updatedAt: string };

/** The `limit` most recently changed maps and encounters, newest first. */
export function recentItems(
  maps: { ref: DocRef; doc: BattleMap }[],
  encounters: { campaign: Campaign; encounter: Encounter }[],
  limit: number,
): RecentItem[] {
  const items: RecentItem[] = [
    ...maps.map(({ ref, doc }) => ({ kind: 'map' as const, ref, map: doc, updatedAt: doc.updatedAt })),
    ...encounters.map((e) => ({ kind: 'encounter' as const, ...e, updatedAt: e.encounter.updatedAt })),
  ];
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
