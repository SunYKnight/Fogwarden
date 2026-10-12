import type { Vec2 } from '../model/common';
import type { HeightField } from '../terrain/heightfield';

/** Vertical wall span that stops a ray crossing it between `bottomFt` and `topFt` (at `a` and `b`). */
export interface Blocker {
  a: Vec2;
  b: Vec2;
  bottomFt: [number, number];
  topFt: [number, number];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const SEGMENT_STRIDE = 8;
// Bilinear terrain and float rounding must not let flat ground hide itself.
const TERRAIN_EPSILON_FT = 0.05;
// A viewer standing exactly on a wall line is not blocked by that wall.
const MIN_RAY_T = 1e-9;

/**
 * Uniform bucket grid for line-of-sight tests. A ray walks only the buckets it crosses (Amanatides-Woo),
 * tests the wall spans registered there and samples terrain only where the bucket's highest terrain
 * sample reaches the ray.
 */
export class RayGrid {
  private readonly originX: number;
  private readonly originY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly segments: Float64Array;
  private readonly bucketStart: Int32Array;
  private readonly bucketItems: Int32Array;
  private readonly stamps: Int32Array;
  private readonly terrainMax: Float32Array;
  private ray = 0;

  constructor(
    bounds: Bounds,
    private readonly bucketFt: number,
    private readonly terrain: HeightField,
    blockers: Blocker[],
  ) {
    this.originX = bounds.minX - bucketFt;
    this.originY = bounds.minY - bucketFt;
    this.cols = Math.ceil((bounds.maxX - this.originX) / bucketFt) + 1;
    this.rows = Math.ceil((bounds.maxY - this.originY) / bucketFt) + 1;
    this.segments = new Float64Array(blockers.length * SEGMENT_STRIDE);
    blockers.forEach((blocker, index) => {
      this.segments.set(
        [blocker.a.x, blocker.a.y, blocker.b.x, blocker.b.y, ...blocker.bottomFt, ...blocker.topFt],
        index * SEGMENT_STRIDE,
      );
    });
    this.stamps = new Int32Array(blockers.length);
    const { start, items } = this.bucketize(blockers);
    this.bucketStart = start;
    this.bucketItems = items;
    this.terrainMax = this.terrainMaxima();
  }

  /** Whether anything blocks the straight line from (px, py, ph) to (qx, qy, qh). */
  blocked(px: number, py: number, ph: number, qx: number, qy: number, qh: number): boolean {
    const dx = qx - px;
    const dy = qy - py;
    const dh = qh - ph;
    // Math.hypot is several times slower than sqrt in V8; this runs per ray.
    const step = this.terrain.spacingFt / Math.max(Math.sqrt(dx * dx + dy * dy), 1e-9);
    this.ray++;
    let col = this.colOf(px);
    let row = this.rowOf(py);
    const endCol = this.colOf(qx);
    const endRow = this.rowOf(qy);
    const stepCol = dx > 0 ? 1 : -1;
    const stepRow = dy > 0 ? 1 : -1;
    const deltaX = dx === 0 ? Infinity : this.bucketFt / Math.abs(dx);
    const deltaY = dy === 0 ? Infinity : this.bucketFt / Math.abs(dy);
    let maxX = dx === 0 ? Infinity : ((col + (dx > 0 ? 1 : 0)) * this.bucketFt + this.originX - px) / dx;
    let maxY = dy === 0 ? Infinity : ((row + (dy > 0 ? 1 : 0)) * this.bucketFt + this.originY - py) / dy;
    let tEnter = 0;
    let hit = false;
    let done = false;
    while (!hit && !done) {
      const tExit = Math.min(maxX, maxY, 1);
      const bucket = row * this.cols + col;
      const hasWalls = this.bucketStart[bucket] !== this.bucketStart[bucket + 1];
      const reach = this.terrainMax[bucket]! + TERRAIN_EPSILON_FT;
      const lowest = Math.min(ph + dh * tEnter, ph + dh * tExit);
      hit =
        (hasWalls && this.hitsWall(bucket, px, py, ph, dx, dy, dh)) ||
        (lowest < reach && this.hitsTerrain(reach, tEnter, tExit, step, px, py, ph, dx, dy, dh));
      done = tExit >= 1 || (col === endCol && row === endRow);
      if (maxX < maxY) {
        col += stepCol;
        maxX += deltaX;
      } else {
        row += stepRow;
        maxY += deltaY;
      }
      done = done || col < 0 || row < 0 || col >= this.cols || row >= this.rows;
      tEnter = tExit;
    }
    return hit;
  }

  private colOf(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.originX) / this.bucketFt)));
  }

  private rowOf(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.originY) / this.bucketFt)));
  }

  private hitsWall(bucket: number, px: number, py: number, ph: number, dx: number, dy: number, dh: number) {
    const s = this.segments;
    const end = this.bucketStart[bucket + 1]!;
    let hit = false;
    for (let i = this.bucketStart[bucket]!; i < end && !hit; i++) {
      const index = this.bucketItems[i]!;
      if (this.stamps[index] !== this.ray) {
        this.stamps[index] = this.ray;
        const o = index * SEGMENT_STRIDE;
        const ax = s[o]!;
        const ay = s[o + 1]!;
        const sx = s[o + 2]! - ax;
        const sy = s[o + 3]! - ay;
        const denom = dx * sy - dy * sx;
        const t = denom === 0 ? -1 : ((ax - px) * sy - (ay - py) * sx) / denom;
        const u = denom === 0 ? -1 : ((ax - px) * dy - (ay - py) * dx) / denom;
        if (t > MIN_RAY_T && t <= 1 && u >= 0 && u <= 1) {
          const h = ph + dh * t;
          const bottom = s[o + 4]! + (s[o + 5]! - s[o + 4]!) * u;
          const top = s[o + 6]! + (s[o + 7]! - s[o + 6]!) * u;
          hit = h >= bottom && h <= top;
        }
      }
    }
    return hit;
  }

  /** Samples the terrain only along the part of the bucket where the ray is lower than `reach`. */
  private hitsTerrain(
    reach: number,
    tEnter: number,
    tExit: number,
    step: number,
    px: number,
    py: number,
    ph: number,
    dx: number,
    dy: number,
    dh: number,
  ): boolean {
    const tCross = dh === 0 ? tEnter : (reach - ph) / dh;
    const from = dh < 0 ? Math.max(tEnter, tCross) : tEnter;
    const to = dh > 0 ? Math.min(tExit, tCross) : tExit;
    let hit = false;
    // One sample lattice per ray: bucket size must not change the result.
    for (let t = Math.ceil(from / step) * step; t <= to && !hit; t += step) {
      hit = this.terrain.sample(px + dx * t, py + dy * t) > ph + dh * t + TERRAIN_EPSILON_FT;
    }
    return hit;
  }

  /** Compressed bucket lists: blocker indices of bucket i are items[start[i] .. start[i + 1]). */
  private bucketize(blockers: Blocker[]): { start: Int32Array; items: Int32Array } {
    const ranges = blockers.map((b) => ({
      col0: this.colOf(Math.min(b.a.x, b.b.x)),
      col1: this.colOf(Math.max(b.a.x, b.b.x)),
      row0: this.rowOf(Math.min(b.a.y, b.b.y)),
      row1: this.rowOf(Math.max(b.a.y, b.b.y)),
    }));
    const start = new Int32Array(this.cols * this.rows + 1);
    for (const r of ranges) {
      for (let row = r.row0; row <= r.row1; row++) {
        for (let col = r.col0; col <= r.col1; col++) {
          start[row * this.cols + col + 1]!++;
        }
      }
    }
    for (let i = 1; i < start.length; i++) {
      start[i]! += start[i - 1]!;
    }
    const items = new Int32Array(start[start.length - 1]!);
    const fill = start.slice(0, -1);
    ranges.forEach((r, index) => {
      for (let row = r.row0; row <= r.row1; row++) {
        for (let col = r.col0; col <= r.col1; col++) {
          items[fill[row * this.cols + col]!++] = index;
        }
      }
    });
    return { start, items };
  }

  /** Highest height sample per bucket; buckets outside the field use its border like `sample` does. */
  private terrainMaxima(): Float32Array {
    const field = this.terrain;
    const result = new Float32Array(this.cols * this.rows);
    const sampleIndex = (ft: number, count: number) =>
      Math.min(count - 1, Math.max(0, Math.floor(ft / field.spacingFt)));
    for (let row = 0; row < this.rows; row++) {
      const y0 = this.originY + row * this.bucketFt;
      const r0 = sampleIndex(y0, field.rows);
      const r1 = Math.min(field.rows - 1, sampleIndex(y0 + this.bucketFt, field.rows) + 1);
      for (let col = 0; col < this.cols; col++) {
        const x0 = this.originX + col * this.bucketFt;
        const c0 = sampleIndex(x0, field.cols);
        const c1 = Math.min(field.cols - 1, sampleIndex(x0 + this.bucketFt, field.cols) + 1);
        let max = -Infinity;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            max = Math.max(max, field.data[r * field.cols + c]!);
          }
        }
        result[row * this.cols + col] = max;
      }
    }
    return result;
  }
}
