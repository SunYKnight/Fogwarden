import type { HitTag } from '@/render/mapRenderContext';
import { useEditorStore, type Selection } from '@/state/editorStore';
import type { EditorTool } from '../tool';
import { cancelVertexDrag, SelectionOverlay, vertexDragPointer } from './structure/selectionEditing';

type SelectableKind = NonNullable<Selection>['kind'];

const SELECTABLE: Partial<Record<HitTag['kind'], SelectableKind>> = {
  wall: 'wall',
  opening: 'opening',
  room: 'room',
  roof: 'room',
  region: 'region',
  light: 'light',
  prop: 'prop',
};

/** What a click on `hit` selects; roofs select their room. */
function selectable(hit: HitTag | null): { kind: SelectableKind; id: string } | null {
  const kind = hit ? SELECTABLE[hit.kind] : undefined;
  return hit && kind ? { kind, id: hit.id } : null;
}

export const selectTool: EditorTool = {
  id: 'select',
  label: 'Select',
  icon: 'cursor',
  shortcut: 'v',
  hint:
    'Click an object to edit it in the inspector; drag a vertex of the selected wall, room or region to move it; ' +
    'Del deletes the selection',
  cursor: 'default',
  onPointer: (event) => {
    const dragged = vertexDragPointer(event);
    const target = selectable(event.hit);
    if (event.type === 'move') {
      useEditorStore.getState().setHover(dragged ? null : target);
    } else if (!dragged && event.type === 'down' && event.button === 0) {
      useEditorStore.getState().select(target && { ...target, vertex: null });
    }
  },
  Overlay: SelectionOverlay,
  deactivate: () => {
    cancelVertexDrag();
    useEditorStore.getState().setHover(null);
  },
};
