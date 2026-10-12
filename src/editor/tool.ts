import type { ComponentType } from 'react';
import type { MapPointerEvent } from '@/render/mapRenderContext';

export type ToolGroup = 'select' | 'terrain' | 'structure' | 'scene';

/**
 * A map editor tool. Tools read and write the editor store directly
 * (`useEditorStore.getState()`); every document change goes through `edit`, `replaceTerrain`
 * or a terrain stroke so it is undoable and autosaved.
 */
export interface EditorTool {
  id: string;
  label: string;
  /** Short glyph shown on the tool button. */
  icon: string;
  group: ToolGroup;
  /** Single key that activates the tool. */
  shortcut?: string;
  /** Status line shown over the viewport while the tool is active. */
  hint?: string;
  onPointer?: (event: MapPointerEvent) => void;
  /** Options for the tool, shown in the side panel. */
  Panel?: ComponentType;
  /** three.js children rendered in the viewport while the tool is active (cursor, previews). */
  Overlay?: ComponentType;
  /** Called when another tool becomes active. */
  deactivate?: () => void;
}
