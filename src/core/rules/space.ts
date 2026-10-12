import type { CreatureSize, Grid, Vec2 } from '../model';

/** Space a creature controls per 5e size, in feet. */
export const CREATURE_SPACE_FT: Record<CreatureSize, number> = {
  tiny: 2.5,
  small: 5,
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

/** Width of a token's footprint in whole squares; tiny creatures still take one square. */
export function footprintSquares(size: CreatureSize, grid: Grid): number {
  return Math.max(1, Math.round(CREATURE_SPACE_FT[size] / grid.feetPerSquare));
}

/** Squares under a token centred at `center` (see `snapTokenPoint`). */
export function footprintCells(center: Vec2, size: CreatureSize, grid: Grid): { col: number; row: number }[] {
  const squares = footprintSquares(size, grid);
  const half = (squares * grid.feetPerSquare) / 2;
  const col0 = Math.round((center.x - half) / grid.feetPerSquare);
  const row0 = Math.round((center.y - half) / grid.feetPerSquare);
  return Array.from({ length: squares * squares }, (_, i) => ({
    col: col0 + (i % squares),
    row: row0 + Math.floor(i / squares),
  }));
}
