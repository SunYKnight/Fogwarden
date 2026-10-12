import type { ComponentType } from 'react';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import type { IconName } from '@/ui/kit';

/** Editor steps in the recommended order of work; each is a tab with its own tools. */
export type EditorStep = 'ground' | 'walls' | 'areas' | 'objects';

/**
 * A map editor tool. Tools read and write the editor store directly
 * (`useEditorStore.getState()`); every document change goes through `edit`, `replaceTerrain`
 * or a terrain stroke so it is undoable and autosaved.
 */
export interface EditorTool {
  id: string;
  label: string;
  icon: IconName;
  /** Step tab that lists the tool; select and tools opened from elsewhere (calibration) have none. */
  step?: EditorStep;
  /** Single key that activates the tool. */
  shortcut?: string;
  /** Status line shown at the bottom while the tool is active. */
  hint?: string;
  /** CSS cursor over the map: crosshair for drawing, none where the overlay draws its own (brush ring). */
  cursor?: 'default' | 'crosshair' | 'none';
  onPointer?: (event: MapPointerEvent) => void;
  /** Options for the tool, shown inline in the tool bar. */
  Panel?: ComponentType;
  /** three.js children rendered in the viewport while the tool is active (cursor, previews). */
  Overlay?: ComponentType;
  /** Called when another tool becomes active. */
  deactivate?: () => void;
}
