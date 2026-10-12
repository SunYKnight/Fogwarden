import type { Vec2 } from '../model/common';
import type { HeightField } from './heightfield';

export const FALLOFFS = ['smooth', 'linear', 'constant'] as const;
export type Falloff = (typeof FALLOFFS)[number];

/** Inclusive range of sample indices touched by a brush. */
export interface SampleRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export interface Brush {
  center: Vec2;
  radiusFt: number;
  falloff: Falloff;
}

/** Brush influence 0..1 at a distance from the brush center; 0 at and beyond the radius. */
export function falloffWeight(distanceFt: number, radiusFt: number, falloff: Falloff): number {
  const t = radiusFt > 0 ? 1 - distanceFt / radiusFt : 0;
  let weight = 0;
  if (t > 0) {
    const weights: Record<Falloff, number> = { constant: 1, linear: t, smooth: t * t * (3 - 2 * t) };
    weight = weights[falloff];
  }
  return weight;
}

/** Samples inside a map plane box, clamped to the field; null when the box misses the field. */
export function rectForBox(field: HeightField, min: Vec2, max: Vec2): SampleRect | null {
  const s = field.spacingFt;
  const rect = {
    c0: Math.max(0, Math.ceil(min.x / s)),
    r0: Math.max(0, Math.ceil(min.y / s)),
    c1: Math.min(field.cols - 1, Math.floor(max.x / s)),
    r1: Math.min(field.rows - 1, Math.floor(max.y / s)),
  };
  return rect.c0 <= rect.c1 && rect.r0 <= rect.r1 ? rect : null;
}

export function brushRect(field: HeightField, center: Vec2, radiusFt: number): SampleRect | null {
  return rectForBox(
    field,
    { x: center.x - radiusFt, y: center.y - radiusFt },
    { x: center.x + radiusFt, y: center.y + radiusFt },
  );
}

export function unionRect(a: SampleRect | null, b: SampleRect | null): SampleRect | null {
  return a && b
    ? { c0: Math.min(a.c0, b.c0), r0: Math.min(a.r0, b.r0), c1: Math.max(a.c1, b.c1), r1: Math.max(a.r1, b.r1) }
    : (a ?? b);
}

/**
 * Replaces every sample with nonzero brush weight by `next(height, weight, col, row)`. New heights are
 * collected first so operators reading neighbours (smooth) see the heights from before this dab.
 */
function applyBrush(
  field: HeightField,
  brush: Brush,
  next: (height: number, weight: number, col: number, row: number) => number,
): SampleRect | null {
  const rect = brushRect(field, brush.center, brush.radiusFt);
  if (rect) {
    const s = field.spacingFt;
    const updates: number[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) {
        const weight = falloffWeight(
          Math.hypot(c * s - brush.center.x, r * s - brush.center.y),
          brush.radiusFt,
          brush.falloff,
        );
        if (weight > 0) {
          const i = field.index(c, r);
          updates.push(i, next(field.data[i]!, weight, c, r));
        }
      }
    }
    for (let k = 0; k < updates.length; k += 2) {
      field.data[updates[k]!] = updates[k + 1]!;
    }
  }
  return rect;
}

/** Adds `amountFt` at the brush center (negative lowers), scaled by the falloff. */
export function raiseBrush(field: HeightField, brush: Brush, amountFt: number): SampleRect | null {
  return applyBrush(field, brush, (h, w) => h + amountFt * w);
}

/** Blends towards the 3x3 neighbourhood mean. */
export function smoothBrush(field: HeightField, brush: Brush, strength: number): SampleRect | null {
  return applyBrush(field, brush, (h, w, c, r) => {
    let sum = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        sum += field.at(c + dc, r + dr);
      }
    }
    return h + (sum / 9 - h) * strength * w;
  });
}

export function flattenBrush(field: HeightField, brush: Brush, targetFt: number, strength: number): SampleRect | null {
  return applyBrush(field, brush, (h, w) => h + (targetFt - h) * strength * w);
}

/** Blends towards the nearest multiple of `stepFt`; at full strength slopes become flat steps with cliffs. */
export function terraceBrush(field: HeightField, brush: Brush, stepFt: number, strength: number): SampleRect | null {
  return applyBrush(field, brush, (h, w) => h + (Math.round(h / stepFt) * stepFt - h) * strength * w);
}

/** Adds `amountFt` times a deterministic noise pattern with features about `scaleFt` large. */
export function noiseBrush(
  field: HeightField,
  brush: Brush,
  amountFt: number,
  scaleFt: number,
  seed: number,
): SampleRect | null {
  const s = field.spacingFt;
  return applyBrush(
    field,
    brush,
    (h, w, c, r) => h + amountFt * w * valueNoise((c * s) / scaleFt, (r * s) / scaleFt, seed),
  );
}

/**
 * Linear slope from `from` (height `fromFt`) to `to` (height `toFt`), `brush.radiusFt` to each side of
 * the line. The falloff runs across the ramp so its sides blend into the surrounding terrain.
 */
export function rampBrush(
  field: HeightField,
  from: Vec2,
  to: Vec2,
  fromFt: number,
  toFt: number,
  brush: Omit<Brush, 'center'>,
  strength: number,
): SampleRect | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const r = brush.radiusFt;
  const box = rectForBox(
    field,
    { x: Math.min(from.x, to.x) - r, y: Math.min(from.y, to.y) - r },
    { x: Math.max(from.x, to.x) + r, y: Math.max(from.y, to.y) + r },
  );
  let touched: SampleRect | null = null;
  if (box && lengthSq > 0) {
    const s = field.spacingFt;
    for (let row = box.r0; row <= box.r1; row++) {
      for (let col = box.c0; col <= box.c1; col++) {
        const px = col * s - from.x;
        const py = row * s - from.y;
        const t = (px * dx + py * dy) / lengthSq;
        const across = Math.hypot(px - t * dx, py - t * dy);
        const weight = t >= 0 && t <= 1 ? falloffWeight(across, r, brush.falloff) * strength : 0;
        if (weight > 0) {
          const i = field.index(col, row);
          const h = field.data[i]!;
          field.data[i] = h + (fromFt + (toFt - fromFt) * t - h) * weight;
          touched = unionRect(touched, { c0: col, r0: row, c1: col, r1: row });
        }
      }
    }
  }
  return touched;
}

/**
 * Dab positions every `spacingFt` from the previous dab `last` towards `next`, so the amount applied
 * depends on the distance travelled and not on how often pointer events arrive.
 */
export function strokeDabs(last: Vec2, next: Vec2, spacingFt: number): Vec2[] {
  const distance = Math.hypot(next.x - last.x, next.y - last.y);
  const count = spacingFt > 0 ? Math.floor(distance / spacingFt) : 0;
  const dabs: Vec2[] = [];
  for (let k = 1; k <= count; k++) {
    const t = (k * spacingFt) / distance;
    dabs.push({ x: last.x + (next.x - last.x) * t, y: last.y + (next.y - last.y) * t });
  }
  return dabs;
}

function latticeValue(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function smoothLattice(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = x - ix;
  const ty = y - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const top = latticeValue(ix, iy, seed) * (1 - sx) + latticeValue(ix + 1, iy, seed) * sx;
  const bottom = latticeValue(ix, iy + 1, seed) * (1 - sx) + latticeValue(ix + 1, iy + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** Deterministic fractal value noise in [-1, 1] with features about 1 unit large. */
export function valueNoise(x: number, y: number, seed: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < 3; octave++) {
    const frequency = 2 ** octave;
    sum += smoothLattice(x * frequency, y * frequency, seed + octave * 101) * amplitude;
    total += amplitude;
    amplitude /= 2;
  }
  return sum / total;
}
