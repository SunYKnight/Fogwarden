import type { ExtrudeGeometry } from 'three';
import type { Room } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { slabGeometry } from './drape';

const ROOF_THICKNESS_FT = 0.5;
const FLOOR_SINK_FT = 0.5;

function terrainRange(polygon: Room['polygon'], terrain: HeightField): { min: number; max: number } {
  const heights = polygon.map((p) => terrain.sample(p.x, p.y));
  return { min: Math.min(...heights), max: Math.max(...heights) };
}

/** Floor slab reaching below the terrain under the room, so no gap shows on slopes. */
export function roomFloorGeometry(room: Room, terrain: HeightField): ExtrudeGeometry {
  const top = room.floorFt ?? 0;
  return slabGeometry(room.polygon, Math.min(top, terrainRange(room.polygon, terrain).min - FLOOR_SINK_FT), top);
}

/** Roof slab at ceiling height above the floor, or above the highest ground without a floor. */
export function roomRoofGeometry(room: Room, terrain: HeightField): ExtrudeGeometry {
  const base = room.floorFt ?? terrainRange(room.polygon, terrain).max;
  const bottom = base + room.ceilingFt;
  return slabGeometry(room.polygon, bottom, bottom + ROOF_THICKNESS_FT);
}
