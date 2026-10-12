import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import type { BattleMap, Encounter } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { History } from './history';

enablePatches();

// The log records what happened and fog what players have seen; undoing a move
// must neither erase its log line nor re-fog explored ground. Updates touching
// only these fields (dice rolls, notes, fog tracking, fog brush) leave no step.
const UNTRACKED: Record<string, boolean> = { log: true, fog: true };

const history = new History();

interface EncounterState {
  encounter: Encounter | null;
  /** Map the encounter plays on; read-only during play (door states live in the encounter). */
  map: BattleMap | null;
  terrain: HeightField | null;
  /** Incremented on every encounter change; autosave and player sync watch it. */
  revision: number;
  savedRevision: number;
  selectedCombatantId: string | null;
  canUndo: boolean;
  canRedo: boolean;

  open(encounter: Encounter, map: BattleMap | null): void;
  close(): void;
  /** Applies `recipe`; changes outside the log and fog become one undo step named `label`. */
  update(recipe: (draft: Draft<Encounter>) => void, label?: string): void;
  /** Reverts the last undo step; returns its label, null when there was none. */
  undo(): string | null;
  redo(): string | null;
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
  canUndo: false,
  canRedo: false,

  open: (encounter, map) => {
    history.clear();
    set({
      encounter,
      map,
      terrain: map ? HeightField.fromMap(map) : null,
      revision: 0,
      savedRevision: 0,
      selectedCombatantId: null,
      canUndo: false,
      canRedo: false,
    });
  },

  close: () => {
    history.clear();
    set({ encounter: null, map: null, terrain: null, selectedCombatantId: null, canUndo: false, canRedo: false });
  },

  update: (recipe, label = 'Change') => {
    const { encounter } = get();
    if (!encounter) {
      throw new Error('No encounter is open');
    }
    const [next, patches, inverse] = produceWithPatches(encounter, recipe);
    const tracked = (p: Patch) => !UNTRACKED[String(p.path[0])];
    const undoable = patches.filter(tracked);
    if (undoable.length > 0) {
      history.push({ kind: 'patches', label, patches: undoable, inverse: inverse.filter(tracked) });
    }
    if (next !== encounter) {
      set((s) => ({ encounter: next, revision: s.revision + 1, canUndo: history.canUndo, canRedo: history.canRedo }));
    }
  },

  undo: () => applyHistoryStep('undo'),
  redo: () => applyHistoryStep('redo'),

  select: (selectedCombatantId) => set({ selectedCombatantId }),
  markSaved: (revision) => set({ savedRevision: revision }),
}));

function applyHistoryStep(direction: 'undo' | 'redo'): string | null {
  const { encounter } = useEncounterStore.getState();
  const entry = encounter ? (direction === 'undo' ? history.takeUndo() : history.takeRedo()) : undefined;
  if (encounter && entry?.kind === 'patches') {
    const next = applyPatches(encounter, direction === 'undo' ? entry.inverse : entry.patches);
    useEncounterStore.setState((s) => ({
      encounter: next,
      revision: s.revision + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }));
  }
  return entry?.label ?? null;
}
