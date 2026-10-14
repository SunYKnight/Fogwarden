import { base64ToFloat32, float32ToBase64 } from '../binary';
import type { BattleMap, Grid } from '../model/map';

/** Regular grid of terrain heights (feet) covering the whole map, origin at the north-west corner. */
export class HeightField {
  readonly cols: number;
  readonly rows: number;
  readonly spacingFt: number;
  readonly data: Float32Array;

  constructor(cols: number, rows: number, spacingFt: number, data?: Float32Array) {
    if (data && data.length !== cols * rows) {
      throw new Error(`Height field ${cols}x${rows} needs ${cols * rows} samples, got ${data.length}`);
    }
    this.cols = cols;
    this.rows = rows;
    this.spacingFt = spacingFt;
    this.data = data ?? new Float32Array(cols * rows);
  }

  static dimensions(grid: Grid, samplesPerSquare: number): { cols: number; rows: number; spacingFt: number } {
    return {
      cols: grid.squaresX * samplesPerSquare + 1,
      rows: grid.squaresY * samplesPerSquare + 1,
      spacingFt: grid.feetPerSquare / samplesPerSquare,
    };
  }

  static empty(grid: Grid, samplesPerSquare: number): HeightField {
    const { cols, rows, spacingFt } = HeightField.dimensions(grid, samplesPerSquare);
    return new HeightField(cols, rows, spacingFt);
  }

  static fromMap(map: BattleMap): HeightField {
    const { cols, rows, spacingFt } = HeightField.dimensions(map.grid, map.terrain.samplesPerSquare);
    const data = map.terrain.heights.length === 0 ? undefined : base64ToFloat32(map.terrain.heights);
    return new HeightField(cols, rows, spacingFt, data);
  }

  get widthFt(): number {
    return (this.cols - 1) * this.spacingFt;
  }

  get depthFt(): number {
    return (this.rows - 1) * this.spacingFt;
  }

  index(col: number, row: number): number {
    return row * this.cols + col;
  }

  at(col: number, row: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, col));
    const r = Math.min(this.rows - 1, Math.max(0, row));
    return this.data[r * this.cols + c]!;
  }

  /** Bilinear height at a map plane point; points outside the field clamp to the border. */
  sample(xFt: number, yFt: number): number {
    const fx = Math.min(this.cols - 1, Math.max(0, xFt / this.spacingFt));
    const fy = Math.min(this.rows - 1, Math.max(0, yFt / this.spacingFt));
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const tx = fx - c0;
    const ty = fy - r0;
    const top = this.at(c0, r0) * (1 - tx) + this.at(c0 + 1, r0) * tx;
    const bottom = this.at(c0, r0 + 1) * (1 - tx) + this.at(c0 + 1, r0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }

  max(): number {
    let result = -Infinity;
    for (const value of this.data) {
      result = Math.max(result, value);
    }
    return result;
  }

  clone(): HeightField {
    return new HeightField(this.cols, this.rows, this.spacingFt, new Float32Array(this.data));
  }

  encode(): string {
    return float32ToBase64(this.data);
  }
}
