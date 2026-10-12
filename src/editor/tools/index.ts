import type { EditorTool } from '../tool';
import { selectTool } from './selectTool';
import { STRUCTURE_TOOLS } from './structure';
import { TERRAIN_TOOLS } from './terrain';

/** Tool palette order: select, terrain tools, then structure and scene tools. */
export const TOOLS: EditorTool[] = [selectTool, ...TERRAIN_TOOLS, ...STRUCTURE_TOOLS];

export function toolById(id: string): EditorTool {
  return TOOLS.find((t) => t.id === id) ?? selectTool;
}
