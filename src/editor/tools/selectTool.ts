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

export const selectTool: EditorTool = {
  id: 'select',
  label: 'Select',
  icon: '⬚',
  group: 'select',
  shortcut: 'v',
  hint: 'Click an object to edit it in the side panel; drag a vertex of the selected wall, room or region to move it',
  onPointer: (event) => {
    if (!vertexDragPointer(event) && event.type === 'down' && event.button === 0) {
      const kind = event.hit ? SELECTABLE[event.hit.kind] : undefined;
      const selection: Selection = event.hit && kind ? { kind, id: event.hit.id, vertex: null } : null;
      useEditorStore.getState().select(selection);
    }
  },
  Overlay: SelectionOverlay,
  deactivate: cancelVertexDrag,
};
