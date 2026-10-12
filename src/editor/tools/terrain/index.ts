import type { EditorTool } from '../../tool';
import { rampTool } from './ramp';
import { flattenTool, lowerTool, noiseTool, raiseTool, smoothTool, terraceTool } from './sculpt';

/** Sculpting tools, in tool bar order. */
export const TERRAIN_TOOLS: EditorTool[] = [
  raiseTool,
  lowerTool,
  smoothTool,
  flattenTool,
  rampTool,
  terraceTool,
  noiseTool,
];
