import { create } from 'zustand';
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
