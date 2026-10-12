import { base64ToBytes, BitSet } from '../binary';
import type { Vec2 } from '../model/common';
import type { Fog } from '../model/encounter';
import type { Grid } from '../model/map';

/** Fog cell values shared by the visibility computation, the sync payload and the fog shader. */
export const FOG_UNKNOWN = 0;
export const FOG_EXPLORED = 128;
export const FOG_VISIBLE = 255;

export interface FogSize {
  cellsX: number;
  cellsY: number;
  cellFt: number;
}

/** Fog value per cell of `size`, row-major from the north-west corner. */
export interface FogCells {
  size: FogSize;
  cells: Uint8Array;
}

export function fogSize(grid: Grid, cellsPerSquare: number): FogSize {
  return {
    cellsX: grid.squaresX * cellsPerSquare,
    cellsY: grid.squaresY * cellsPerSquare,
    cellFt: grid.feetPerSquare / cellsPerSquare,
  };
}

/** Row-major index of the fog cell under a map point, or -1 outside the map. */
export function fogCellAt(point: Vec2, size: FogSize): number {
  const col = Math.floor(point.x / size.cellFt);
  const row = Math.floor(point.y / size.cellFt);
  const inside = col >= 0 && row >= 0 && col < size.cellsX && row < size.cellsY;
  return inside ? row * size.cellsX + col : -1;
}

/** Inclusive column/row range of the fog cells touching a map-plane box, clamped to the map. */
export function cellRange(size: FogSize, minX: number, minY: number, maxX: number, maxY: number) {
  return {
    col0: Math.max(0, Math.floor(minX / size.cellFt)),
    col1: Math.min(size.cellsX - 1, Math.floor(maxX / size.cellFt)),
    row0: Math.max(0, Math.floor(minY / size.cellFt)),
    row1: Math.min(size.cellsY - 1, Math.floor(maxY / size.cellFt)),
  };
}

/**
 * Reads a stored fog bitset. A stored set of another length belongs to the map before it was resized,
 * so its bits no longer address the same cells and an empty set takes its place.
 */
export function readFogBits(base64: string, cellCount: number): BitSet {
  const bytes = base64.length === 0 ? null : base64ToBytes(base64);
  return bytes?.length === Math.ceil(cellCount / 8) ? new BitSet(cellCount, bytes) : new BitSet(cellCount);
}

/** Adds the visible cells to `explored`, except cells the DM hides; returns whether a bit changed. */
export function accumulateExplored(explored: BitSet, visible: Uint8Array, hidden: BitSet): boolean {
  let changed = false;
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] === FOG_VISIBLE && !explored.get(i) && !hidden.get(i)) {
      explored.set(i, true);
      changed = true;
    }
  }
  return changed;
}

/** Final fog per cell: DM-hidden cells stay unknown, DM-revealed cells count as explored. */
export function composeFog(visible: Uint8Array, explored: BitSet, revealed: BitSet, hidden: BitSet): Uint8Array {
  const cells = new Uint8Array(visible.length);
  for (let i = 0; i < cells.length; i++) {
    const remembered = explored.get(i) || revealed.get(i) ? FOG_EXPLORED : FOG_UNKNOWN;
    const seen = visible[i] === FOG_VISIBLE ? FOG_VISIBLE : remembered;
    cells[i] = hidden.get(i) ? FOG_UNKNOWN : seen;
  }
  return cells;
}

/** Sets every cell whose centre lies within `radiusFt` of `center` to `value`. */
export function paintFogCircle(bits: BitSet, center: Vec2, radiusFt: number, size: FogSize, value: boolean): void {
  const { x, y } = center;
  const { col0, col1, row0, row1 } = cellRange(size, x - radiusFt, y - radiusFt, x + radiusFt, y + radiusFt);
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const dx = (col + 0.5) * size.cellFt - center.x;
      const dy = (row + 0.5) * size.cellFt - center.y;
      if (dx * dx + dy * dy <= radiusFt * radiusFt) {
        bits.set(row * size.cellsX + col, value);
      }
    }
  }
}

/** The three stored fog bitsets of an encounter, decoded for `size`. */
export function readEncounterFog(fog: Fog, size: FogSize): { explored: BitSet; revealed: BitSet; hidden: BitSet } {
  const count = size.cellsX * size.cellsY;
  return {
    explored: readFogBits(fog.explored, count),
    revealed: readFogBits(fog.revealedByDm, count),
    hidden: readFogBits(fog.hiddenByDm, count),
  };
}
