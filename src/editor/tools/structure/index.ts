import type { EditorTool } from '../../tool';
import { lightTool } from './lightTool';
import { openingTool } from './openingTool';
import { propTool } from './propTool';
import { regionTool } from './regionTool';
import { roomTool } from './roomTool';
import { wallTool } from './wallTool';

/** Wall, opening, room, region, light and prop tools, in palette order. */
export const STRUCTURE_TOOLS: EditorTool[] = [wallTool, openingTool, roomTool, regionTool, lightTool, propTool];
