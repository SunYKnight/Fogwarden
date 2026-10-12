import { create } from 'zustand';
import { resolveTokenAsset, type AssetRef, type Combatant, type Portraits } from '@/core/model';
import type { LibraryKind, LibraryListing } from '@/data/repository';
import { useAppStore } from './appStore';

type Listings = { [K in LibraryKind]: LibraryListing<K> };

interface LibraryState {
  listings: Listings;
  /** Portrait index; loaded with the creature listing. */
  portraits: Portraits;
  loading: Record<LibraryKind, boolean>;
  refresh(kind: LibraryKind): Promise<void>;
  refreshAll(): Promise<void>;
  savePortraits(portraits: Portraits): Promise<void>;
}

const empty = <K extends LibraryKind>(): LibraryListing<K> => ({ entries: [], problems: [] });

export const useLibraryStore = create<LibraryState>((set, get) => ({
  listings: { creature: empty(), marker: empty(), map: empty() },
  portraits: {},
  loading: { creature: false, marker: false, map: false },

  refresh: async (kind) => {
    set((s) => ({ loading: { ...s.loading, [kind]: true } }));
    try {
      const repository = useAppStore.getState().repository;
      const [listing, portraits] = await Promise.all([
        repository.list(kind),
        kind === 'creature' ? repository.loadPortraits() : get().portraits,
      ]);
      set((s) => ({ listings: { ...s.listings, [kind]: listing }, portraits }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [kind]: false } }));
    }
  },

  refreshAll: async () => {
    await Promise.all((['creature', 'marker', 'map'] as const).map((k) => get().refresh(k)));
  },

  savePortraits: async (portraits) => {
    set({ portraits: await useAppStore.getState().repository.savePortraits(portraits) });
  },
}));

type TokenSource = Pick<Combatant, 'token' | 'creature'>;

/** Picture on a combatant's token; creature and portrait are looked up live, so new portraits show at once. */
export function combatantToken(
  combatant: TokenSource,
  library: Pick<LibraryState, 'listings' | 'portraits'>,
): AssetRef | null {
  const id = combatant.creature?.id;
  // By id only: a user override keeps the id of the shipped creature.
  const creature = id === undefined ? null : library.listings.creature.entries.find((e) => e.ref.id === id);
  return resolveTokenAsset(
    combatant.token,
    creature?.doc ?? null,
    id === undefined ? undefined : library.portraits[id],
  );
}

export function useCombatantToken(combatant: TokenSource | undefined): AssetRef | null {
  return useLibraryStore((s) => (combatant ? combatantToken(combatant, s) : null));
}
