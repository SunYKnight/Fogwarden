import type { ComponentType } from 'react';
import type { Selection } from '@/state/editorStore';
import { STRUCTURE_SELECTION_PANELS } from './tools/structure/selectionPanels';

type SelectionKind = NonNullable<Selection>['kind'];

/** Side panel editors for the selected object, keyed by selection kind; modules register their panels here. */
export const SELECTION_PANELS: Partial<Record<SelectionKind, ComponentType<{ id: string }>>> = {
  ...STRUCTURE_SELECTION_PANELS,
};
