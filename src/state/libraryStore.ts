import { create } from 'zustand';
import { resolveTokenAsset, type AssetRef, type Combatant } from '@/core/model';
import type { LibraryKind, LibraryListing } from '@/data/repository';
import { useAppStore } from './appStore';

type Listings = { [K in LibraryKind]: LibraryListing<K> };

interface LibraryState {
  listings: Listings;
  loading: Record<LibraryKind, boolean>;
  refresh(kind: LibraryKind): Promise<void>;
  refreshAll(): Promise<void>;
}

const empty = <K extends LibraryKind>(): LibraryListing<K> => ({ entries: [], problems: [] });

export const useLibraryStore = create<LibraryState>((set, get) => ({
  listings: { creature: empty(), marker: empty(), map: empty() },
  loading: { creature: false, marker: false, map: false },

  refresh: async (kind) => {
    set((s) => ({ loading: { ...s.loading, [kind]: true } }));
    try {
      const listing = await useAppStore.getState().repository.list(kind);
      set((s) => ({ listings: { ...s.listings, [kind]: listing } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [kind]: false } }));
    }
  },

  refreshAll: async () => {
    await Promise.all((['creature', 'marker', 'map'] as const).map((k) => get().refresh(k)));
  },
}));

type TokenSource = Pick<Combatant, 'token' | 'creature'>;

/** Picture on a combatant's token; the creature is looked up live, so new pictures show at once. */
export function combatantToken(combatant: TokenSource, library: Pick<LibraryState, 'listings'>): AssetRef | null {
  const id = combatant.creature?.id;
  // By id only: a user override keeps the id of the shipped creature.
  const creature = id === undefined ? null : library.listings.creature.entries.find((e) => e.ref.id === id);
  return resolveTokenAsset(combatant.token, creature?.doc ?? null);
}

export function useCombatantToken(combatant: TokenSource | undefined): AssetRef | null {
  return useLibraryStore((s) => (combatant ? combatantToken(combatant, s) : null));
}
