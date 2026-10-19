import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import type { BattleMap, Encounter } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { History } from './history';

enablePatches();

// The log records what happened, chat what was said and fog what players have
// seen; undoing a move must neither erase its log line nor re-fog explored
// ground. Updates touching only these fields (dice rolls, notes, chat, fog
// tracking, fog brush) leave no step.
const UNTRACKED: Record<string, boolean> = { log: true, fog: true, chat: true };

/** True for a patch that is part of an undo step: outside the log, chat and fog. */
export function isTrackedPatch(patch: Patch): boolean {
  return !UNTRACKED[String(patch.path[0])];
}

const history = new History();

/** Where a remote DM's store sends its changes: the desktop app applies them and owns the undo history. */
export interface EncounterRemote {
  /** `patches` were applied to the store already, ahead of the desktop. */
  update(patches: Patch[], label: string): void;
  undo(): void;
  redo(): void;
}

/**
 * A change of the open encounter; `from` and `to` are store revisions. `patches` is null when `open` or
 * `close` replaced the encounter (and its map) as a whole.
 */
export interface EncounterChange {
  patches: Patch[] | null;
  from: number;
  to: number;
}

let remote: EncounterRemote | null = null;
const changeListeners = new Set<(change: EncounterChange) => void>();

/**
 * Runs the store as a remote DM's: changes go to `next` instead of the local history, and since the store
 * marks them saved at once, autosave never writes the encounter. Null runs the store locally again.
 */
export function setEncounterRemote(next: EncounterRemote | null): void {
  remote = next;
  history.clear();
}

/** Calls `listener` after every change by `update`, `undo`, `redo`, `open` and `close`; returns the unsubscribe. */
export function onEncounterChange(listener: (change: EncounterChange) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function notify(change: EncounterChange): void {
  for (const listener of changeListeners) {
    listener(change);
  }
}

function changed(next: Encounter, patches: Patch[]): void {
  const from = useEncounterStore.getState().revision;
  useEncounterStore.setState({
    encounter: next,
    revision: from + 1,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  });
  notify({ patches, from, to: from + 1 });
}

interface EncounterState {
  encounter: Encounter | null;
  /** Map the encounter plays on; read-only during play (door states live in the encounter). */
  map: BattleMap | null;
  terrain: HeightField | null;
  /**
   * Incremented on every encounter change; autosave and player sync watch it. Never reset, so a
   * late save of the previous encounter cannot mark this one's edits saved.
   */
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
    set((s) => ({
      encounter,
      map,
      terrain: map ? HeightField.fromMap(map) : null,
      savedRevision: s.revision,
      selectedCombatantId: null,
      canUndo: false,
      canRedo: false,
    }));
    notify({ patches: null, from: get().revision, to: get().revision });
  },

  close: () => {
    history.clear();
    set({ encounter: null, map: null, terrain: null, selectedCombatantId: null, canUndo: false, canRedo: false });
    notify({ patches: null, from: get().revision, to: get().revision });
  },

  update: (recipe, label = 'Change') => {
    const { encounter } = get();
    if (!encounter) {
      throw new Error('No encounter is open');
    }
    const [next, patches, inverse] = produceWithPatches(encounter, recipe);
    const undoable = patches.filter(isTrackedPatch);
    if (remote && next !== encounter) {
      set((s) => ({ encounter: next, revision: s.revision + 1, savedRevision: s.revision + 1 }));
      remote.update(patches, label);
    } else if (!remote && next !== encounter) {
      if (undoable.length > 0) {
        history.push({ kind: 'patches', label, patches: undoable, inverse: inverse.filter(isTrackedPatch) });
      }
      changed(next, patches);
    }
  },

  // A remote DM's step comes back with the desktop's patches; its label is
  // the desktop's to show.
  undo: () => {
    remote?.undo();
    return remote ? null : applyHistoryStep('undo');
  },
  redo: () => {
    remote?.redo();
    return remote ? null : applyHistoryStep('redo');
  },

  select: (selectedCombatantId) => set({ selectedCombatantId }),
  markSaved: (revision) => set((s) => ({ savedRevision: Math.max(s.savedRevision, revision) })),
}));

function applyHistoryStep(direction: 'undo' | 'redo'): string | null {
  const { encounter } = useEncounterStore.getState();
  const entry = encounter ? (direction === 'undo' ? history.takeUndo() : history.takeRedo()) : undefined;
  if (encounter && entry?.kind === 'patches') {
    const patches = direction === 'undo' ? entry.inverse : entry.patches;
    changed(applyPatches(encounter, patches), patches);
  }
  return entry?.label ?? null;
}
