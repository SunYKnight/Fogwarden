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

/** Pack holding a library creature back: disabled, or enabled and hiding its creatures (`hidden`). */
export interface HeldPack {
  name: string;
  hidden: boolean;
}

/**
 * Pack that holds back a combatant's creature, null when it is available or gone. The combatant keeps
 * running from its own copy of HP, AC and conditions; only the stat block is missing.
 */
export function useHeldPackOf(ref: DocRef | null): HeldPack | null {
  const held = useLibraryStore((s) => (ref && s.listings.creature.unavailable.find((u) => u.id === ref.id)) ?? null);
  const packs = useLibraryStore((s) => s.packs);
  return held && { name: packName(packs, held.pack), hidden: held.hidden };
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
