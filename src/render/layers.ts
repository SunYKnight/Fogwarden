import type { ComponentType } from 'react';
import { FogLayer } from './fog/FogLayer';
import { MarkerLayer } from './markers/MarkerLayer';
import { PropLayer } from './props/PropLayer';
import { LightLayer } from './structures/LightLayer';
import { RegionLayer } from './structures/RegionLayer';
import { RoomLayer } from './structures/RoomLayer';
import { StructureLayer } from './structures/StructureLayer';
import { TokenLayer } from './tokens/TokenLayer';

/**
 * Map layers rendered by every map view (editor, DM, player) after the terrain.
 * Each layer reads `useMapRender()` and decides from `mode` what it shows; modules append their layers here.
 */
export const SCENE_LAYERS: { id: string; Component: ComponentType }[] = [
  { id: 'markers', Component: MarkerLayer },
  { id: 'tokens', Component: TokenLayer },
  { id: 'fog', Component: FogLayer },
  { id: 'structures', Component: StructureLayer },
  { id: 'rooms', Component: RoomLayer },
  { id: 'regions', Component: RegionLayer },
  { id: 'lights', Component: LightLayer },
  { id: 'props', Component: PropLayer },
];
