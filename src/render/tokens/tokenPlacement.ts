import type { CreatureSize, Grid, MapPoint, Vec2 } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';

/** Token diameter per 5e creature size. */
export const TOKEN_DIAMETER_FT: Record<CreatureSize, number> = {
  tiny: 2.5,
  small: 5,
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

function snapAxis(value: number, footprintFt: number, feetPerSquare: number, mapFt: number): number {
  const half = footprintFt / 2;
  const corner = Math.round((value - half) / feetPerSquare) * feetPerSquare;
  return Math.max(half, Math.min(mapFt - half, corner + half));
}

/**
 * Centre of the token footprint nearest to `point`: the footprint covers whole squares (tiny creatures
 * still take one square) and stays on the map; the elevation follows the terrain at the centre.
 */
export function snapTokenPoint(point: Vec2, size: CreatureSize, grid: Grid, terrain: HeightField): MapPoint {
  const fps = grid.feetPerSquare;
  const footprintFt = Math.max(1, Math.round(TOKEN_DIAMETER_FT[size] / fps)) * fps;
  const x = snapAxis(point.x, footprintFt, fps, grid.squaresX * fps);
  const y = snapAxis(point.y, footprintFt, fps, grid.squaresY * fps);
  return { x, y, elevationFt: terrain.sample(x, y) };
}
