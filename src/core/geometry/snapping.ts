import type { Vec2 } from '../model/common';
import { distance2 } from './walls';

export type SnapKind = 'vertex' | 'corner' | 'midpoint' | 'none';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
}

export interface SnapOptions {
  /** Only targets closer than this snap. */
  radiusFt: number;
  /** Existing wall vertices (and the points of the wall being drawn). */
  vertices: Vec2[];
}

/**
 * Snaps a map point to the nearest wall vertex, else grid corner, else square-edge midpoint.
 * Vertices win so new walls join existing ones exactly; corners win over midpoints because
 * battlemap walls mostly run along grid lines.
 */
export function snapPoint(point: Vec2, feetPerSquare: number, options: SnapOptions): SnapResult {
  const step = feetPerSquare;
  const corner = { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step };
  const alongX = { x: (Math.floor(point.x / step) + 0.5) * step, y: corner.y };
  const alongY = { x: corner.x, y: (Math.floor(point.y / step) + 0.5) * step };
  const midpoint = distance2(point, alongX) <= distance2(point, alongY) ? alongX : alongY;
  const vertex = options.vertices.reduce<Vec2 | null>(
    (best, v) => (best === null || distance2(point, v) < distance2(point, best) ? v : best),
    null,
  );
  const candidates: SnapResult[] = [
    ...(vertex ? [{ point: { x: vertex.x, y: vertex.y }, kind: 'vertex' as const }] : []),
    { point: corner, kind: 'corner' },
    { point: midpoint, kind: 'midpoint' },
  ];
  return candidates.find((c) => distance2(point, c.point) <= options.radiusFt) ?? { point, kind: 'none' };
}
