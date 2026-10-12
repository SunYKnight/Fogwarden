import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import type { BattleMap, Encounter } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';

interface EncounterState {
  encounter: Encounter | null;
  /** Map the encounter plays on; read-only during play (door states live in the encounter). */
  map: BattleMap | null;
  terrain: HeightField | null;
  /** Incremented on every encounter change; autosave and player sync watch it. */
  revision: number;
  savedRevision: number;
  selectedCombatantId: string | null;

  open(encounter: Encounter, map: BattleMap | null): void;
  close(): void;
  update(recipe: (draft: Draft<Encounter>) => void): void;
  select(combatantId: string | null): void;
  markSaved(revision: number): void;
}

export const useEncounterStore = create<EncounterState>((set, get) => ({
  encounter: null,
  map: null,
  terrain: null,
  revision: 0,
  savedRevision: 0,
  selectedCombatantId: null,

  open: (encounter, map) =>
    set({
      encounter,
      map,
      terrain: map ? HeightField.fromMap(map) : null,
      revision: 0,
      savedRevision: 0,
      selectedCombatantId: null,
    }),

  close: () => set({ encounter: null, map: null, terrain: null, selectedCombatantId: null }),

  update: (recipe) => {
    const { encounter } = get();
    if (!encounter) {
      throw new Error('No encounter is open');
    }
    const next = produce(encounter, recipe);
    if (next !== encounter) {
      set((s) => ({ encounter: next, revision: s.revision + 1 }));
    }
  },

  select: (selectedCombatantId) => set({ selectedCombatantId }),
  markSaved: (revision) => set({ savedRevision: revision }),
}));
