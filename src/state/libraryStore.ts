import { create } from 'zustand';
import { resolveTokenAsset, type AssetRef, type Combatant } from '@/core/model';
import {
  LIBRARY_KINDS,
  type LibraryKind,
  type LibraryListing,
  type LoadProblem,
  type PackInfo,
} from '@/data/repository';
import { useAppStore } from './appStore';

type Listings = { [K in LibraryKind]: LibraryListing<K> };

interface LibraryState {
  listings: Listings;
  loading: Record<LibraryKind, boolean>;
  /** Installed packs in precedence order (My content first) and problems reading them. */
  packs: PackInfo[];
  packProblems: LoadProblem[];
  refresh(kind: LibraryKind): Promise<void>;
  refreshPacks(): Promise<void>;
  /** Every listing and the packs; after pack changes, which touch every kind. */
  refreshAll(): Promise<void>;
}

const empty = <K extends LibraryKind>(): LibraryListing<K> => ({
  entries: [],
  problems: [],
  shadowed: [],
  unavailable: [],
});

export const useLibraryStore = create<LibraryState>((set, get) => ({
  listings: { creature: empty(), marker: empty(), map: empty(), table: empty() },
  loading: { creature: false, marker: false, map: false, table: false },
  packs: [],
  packProblems: [],

  refresh: async (kind) => {
    set((s) => ({ loading: { ...s.loading, [kind]: true } }));
    try {
      const listing = await useAppStore.getState().repository.list(kind);
      set((s) => ({ listings: { ...s.listings, [kind]: listing } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [kind]: false } }));
    }
  },

  refreshPacks: async () => {
    const { packs, problems } = await useAppStore.getState().repository.listPacks();
    set({ packs, packProblems: problems });
  },

  refreshAll: async () => {
    await Promise.all([get().refreshPacks(), ...LIBRARY_KINDS.map((k) => get().refresh(k))]);
  },
}));

/** Display name of an installed pack; the id while packs are loading. */
export function packName(packs: PackInfo[], id: string): string {
  return packs.find((p) => p.source.pack === id)?.manifest.name ?? id;
}

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
