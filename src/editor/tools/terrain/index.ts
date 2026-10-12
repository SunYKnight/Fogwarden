import type { EditorTool } from '../../tool';
import { calibrateTool } from './calibrate';
import { rampTool } from './ramp';
import { flattenTool, lowerTool, noiseTool, raiseTool, smoothTool, terraceTool } from './sculpt';

/** Calibration and sculpting tools, in palette order. */
export const TERRAIN_TOOLS: EditorTool[] = [
  calibrateTool,
  raiseTool,
  lowerTool,
  smoothTool,
  flattenTool,
  rampTool,
  terraceTool,
  noiseTool,
];
