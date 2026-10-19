import { create } from 'zustand';
import { slug } from '@/core/import/ids';
import { resolveTokenAsset, type AssetRef, type CharacterSheet, type Combatant, type LibraryKind } from '@/core/model';
import {
  LIBRARY_KINDS,
  type LibraryDocs,
  type LibraryEntry,
  type LibraryListing,
  type LoadProblem,
  type PackInfo,
} from '@/data/repository';
import { useAppStore } from './appStore';

/** A repository listing plus what the lists show of it. */
export interface ShownListing<K extends LibraryKind> extends LibraryListing<K> {
  /**
   * `entries` without the name duplicates while Settings > Content hides them; lists show these, lookups by
   * id use `entries`, so encounters and loot still find a hidden duplicate.
   */
  listed: LibraryEntry<K>[];
  /** Entries named like one from pack `by` higher up; known even while they are shown. */
  duplicates: { id: string; pack: string; by: string }[];
}

type Listings = { [K in LibraryKind]: ShownListing<K> };

interface LibraryState {
  listings: Listings;
  loading: Record<LibraryKind, boolean>;
  /** Installed packs in precedence order (My content first) and problems reading them. */
  packs: PackInfo[];
  packProblems: LoadProblem[];
  /**
   * Player characters' sheet files by creature id, loaded with the creature listing; characters without one
   * get a sheet derived from their stat block (`sheetFromCreature`).
   */
  characterSheets: Record<string, CharacterSheet>;
  refresh(kind: LibraryKind): Promise<void>;
  refreshPacks(): Promise<void>;
  /** Every listing and the packs; after pack changes, which touch every kind. */
  refreshAll(): Promise<void>;
}

/** Kinds the SRD and the books print alike, so packs repeat them; maps and tables keep every entry. */
const DEDUPLICATED: Record<LibraryKind, boolean> = {
  creature: true,
  marker: true,
  map: false,
  table: false,
  item: true,
  spell: true,
};

/**
 * `listing` with its name duplicates: entries whose name (case, diacritics and punctuation aside) an entry
 * from a pack earlier in `order` (pack ids, My content first) has too. Entries of one pack never hide each
 * other, and player characters only meet player characters. `hide` drops the duplicates from `listed`.
 */
export function withDuplicates<K extends LibraryKind>(
  kind: K,
  listing: LibraryListing<K>,
  order: string[],
  hide: boolean,
): ShownListing<K> {
  const ranks = new Map(order.map((pack, i) => [pack, i]));
  const rank = (entry: LibraryEntry<K>) => ranks.get(entry.pack) ?? order.length;
  const keyOf = (entry: LibraryEntry<K>) => {
    const doc: LibraryDocs[LibraryKind] = entry.doc;
    return `${'kind' in doc && doc.kind === 'player' ? 'player:' : ''}${slug(doc.name)}`;
  };
  const best = new Map<string, LibraryEntry<K>>();
  for (const entry of DEDUPLICATED[kind] ? listing.entries : []) {
    const held = best.get(keyOf(entry));
    if (!held || rank(entry) < rank(held)) {
      best.set(keyOf(entry), entry);
    }
  }
  const duplicates = listing.entries.flatMap((entry) => {
    const top = best.get(keyOf(entry));
    return top && rank(top) < rank(entry) ? [{ id: entry.ref.id, pack: entry.pack, by: top.pack }] : [];
  });
  const hidden = new Set(duplicates.map((d) => d.id));
  const listed = hide ? listing.entries.filter((e) => !hidden.has(e.ref.id)) : listing.entries;
  return { ...listing, listed, duplicates };
}

const empty = <K extends LibraryKind>(): ShownListing<K> => ({
  entries: [],
  problems: [],
  shadowed: [],
  unavailable: [],
  listed: [],
  duplicates: [],
});

// Refreshes of a kind can overlap; only the newest one sets the listing and
// ends the loading state, so a slow older listing never replaces a newer one.
const latestRefresh: Record<LibraryKind, number> = { creature: 0, marker: 0, map: 0, table: 0, item: 0, spell: 0 };

export const useLibraryStore = create<LibraryState>((set, get) => ({
  listings: {
    creature: empty(),
    marker: empty(),
    map: empty(),
    table: empty(),
    item: empty(),
    spell: empty(),
  },
  loading: { creature: false, marker: false, map: false, table: false, item: false, spell: false },
  packs: [],
  packProblems: [],
  characterSheets: {},

  refresh: async (kind) => {
    const mine = ++latestRefresh[kind];
    set((s) => ({ loading: { ...s.loading, [kind]: true } }));
    try {
      const { repository } = useAppStore.getState();
      const [listing, sources, sheets] = await Promise.all([
        repository.list(kind),
        repository.librarySources(),
        kind === 'creature' ? repository.characterSheets() : null,
      ]);
      const order = sources.map((s) => s.pack);
      // Unreadable sheets show among the creatures' load problems.
      const full = sheets ? { ...listing, problems: [...listing.problems, ...sheets.problems] } : listing;
      const shown = withDuplicates(kind, full, order, repository.packSettings.hideDuplicates);
      if (mine === latestRefresh[kind]) {
        set((s) => ({
          listings: { ...s.listings, [kind]: shown },
          ...(sheets && { characterSheets: sheets.sheets }),
        }));
      }
    } finally {
      if (mine === latestRefresh[kind]) {
        set((s) => ({ loading: { ...s.loading, [kind]: false } }));
      }
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
  // By id only: a user override keeps the id of the pack creature.
  const creature = id === undefined ? null : library.listings.creature.entries.find((e) => e.ref.id === id);
  return resolveTokenAsset(combatant.token, creature?.doc ?? null);
}

export function useCombatantToken(combatant: TokenSource | undefined): AssetRef | null {
  return useLibraryStore((s) => (combatant ? combatantToken(combatant, s) : null));
}
