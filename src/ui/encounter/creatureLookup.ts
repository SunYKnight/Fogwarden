import type { Combatant, Creature, DocRef } from '@/core/model';
import { useLibraryStore } from '@/state/libraryStore';

// By id only: a user override keeps the id of the shipped creature it replaces.
function find(entries: { ref: DocRef; doc: Creature }[], ref: DocRef | null): Creature | null {
  return (ref && entries.find((e) => e.ref.id === ref.id)?.doc) ?? null;
}

/** Library creature a combatant was spawned from; null for ad-hoc entries or deleted creatures. */
export function findCreature(ref: DocRef | null): Creature | null {
  return find(useLibraryStore.getState().listings.creature.entries, ref);
}

export function useCreature(ref: DocRef | null): Creature | null {
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  return find(entries, ref);
}

/** Initiative tie-breaker; ad-hoc player characters count as Dexterity 10. */
export function dexScore(combatant: Combatant): number {
  return findCreature(combatant.creature)?.abilities.dex ?? 10;
}
