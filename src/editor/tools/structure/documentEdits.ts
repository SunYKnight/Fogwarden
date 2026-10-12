import type { Draft } from 'immer';
import type { BattleMap } from '@/core/model';
import { useEditorStore, type Selection } from '@/state/editorStore';

/** Undoable change of one map item found by id; a missing item (already deleted) changes nothing. */
export function editItem<T extends { id: string }>(
  label: string,
  pick: (draft: Draft<BattleMap>) => T[],
  id: string,
  recipe: (item: T) => void,
): void {
  useEditorStore.getState().edit(label, (draft) => {
    const item = pick(draft).find((i) => i.id === id);
    if (item) recipe(item);
  });
}

/** Undoable removal of one map item; also clears the selection that showed it. */
export function removeItem<T extends { id: string }>(
  label: string,
  pick: (draft: Draft<BattleMap>) => T[],
  id: string,
): void {
  const editor = useEditorStore.getState();
  editor.edit(label, (draft) => {
    const items = pick(draft);
    const index = items.findIndex((i) => i.id === id);
    if (index >= 0) items.splice(index, 1);
  });
  editor.select(null);
}

/** Adds an item as one undoable step and selects it so its panel opens. */
export function addItem<T extends { id: string }>(
  label: string,
  pick: (draft: Draft<BattleMap>) => T[],
  item: T,
  kind: NonNullable<Selection>['kind'],
): void {
  const editor = useEditorStore.getState();
  editor.edit(label, (draft) => {
    pick(draft).push(item);
  });
  editor.select({ kind, id: item.id, vertex: null });
}

export function editorMap(): BattleMap {
  const map = useEditorStore.getState().map;
  if (!map) {
    throw new Error('No map is open in the editor');
  }
  return map;
}
