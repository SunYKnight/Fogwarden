import { creatureIconOf, type CreatureIconKey } from '@/core/creatureTypeIcon';
import type { Combatant, Creature, DocRef } from '@/core/model';
import { packName, useLibraryStore } from '@/state/libraryStore';

// By id only: a user override keeps the id of the pack creature it replaces.
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

/**
 * Name of the disabled pack that holds a combatant's creature, null when it is available or gone. The
 * combatant keeps running from its own copy of HP, AC and conditions; only the stat block is missing.
 */
export function useDisabledPackOf(ref: DocRef | null): string | null {
  return useLibraryStore((s) => {
    const pack = ref && s.listings.creature.unavailable.find((u) => u.id === ref.id)?.pack;
    return pack ? packName(s.packs, pack) : null;
  });
}

/** Type icon of a token without picture; ad-hoc combatants have no creature type and keep their initials. */
export function combatantTypeIcon(ref: DocRef | null): CreatureIconKey | null {
  const creature = findCreature(ref);
  return creature && creatureIconOf(creature);
}

export function useCombatantTypeIcon(ref: DocRef | null | undefined): CreatureIconKey | null {
  const creature = useCreature(ref ?? null);
  return creature && creatureIconOf(creature);
}

/** Initiative tie-breaker; ad-hoc player characters count as Dexterity 10. */
export function dexScore(combatant: Combatant): number {
  return findCreature(combatant.creature)?.abilities.dex ?? 10;
}
