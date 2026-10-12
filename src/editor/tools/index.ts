import type { EditorTool } from '../tool';
import { selectTool } from './selectTool';
import { STRUCTURE_TOOLS } from './structure';
import { TERRAIN_TOOLS } from './terrain';
import { calibrateTool } from './terrain/calibrate';

/** Every tool: select, the step tools in tool bar order, then calibration (opened from the map settings). */
export const TOOLS: EditorTool[] = [selectTool, ...TERRAIN_TOOLS, ...STRUCTURE_TOOLS, calibrateTool];

export function toolById(id: string): EditorTool {
  return TOOLS.find((t) => t.id === id) ?? selectTool;
}
