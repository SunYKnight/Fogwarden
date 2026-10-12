import { createContext, useContext } from 'react';
import type { BattleMap, MapPoint } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import type { ProjectionUniforms } from './materials/projectedMaterial';

/** Which application surface renders the map; layers decide what to show from it. */
export type RenderMode = 'editor' | 'dm' | 'player';

/** Tag set on `object.userData.hit` so pointer events can tell what was hit. */
export interface HitTag {
  kind: 'terrain' | 'wall' | 'opening' | 'room' | 'roof' | 'region' | 'light' | 'prop' | 'token' | 'marker';
  id: string;
}

export interface MapPointerEvent {
  type: 'down' | 'move' | 'up';
  /** Null for a pointer-up outside every mesh. */
  point: MapPoint | null;
  hit: HitTag | null;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface MapRenderState {
  map: BattleMap;
  terrain: HeightField;
  terrainVersion: number;
  uniforms: ProjectionUniforms;
  mode: RenderMode;
}

export const MapRenderContext = createContext<MapRenderState | null>(null);

export function useMapRender(): MapRenderState {
  const state = useContext(MapRenderContext);
  if (!state) {
    throw new Error('Map layers must be rendered inside <MapView>');
  }
  return state;
}

export function mapSizeFt(map: BattleMap): { width: number; depth: number } {
  return { width: map.grid.squaresX * map.grid.feetPerSquare, depth: map.grid.squaresY * map.grid.feetPerSquare };
}
