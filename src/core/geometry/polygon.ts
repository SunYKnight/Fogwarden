import type { Vec2 } from '../model/common';

/**
 * Shoelace area. The map plane's y axis points south, so a positive value means the points run
 * clockwise when the map is seen from above with north up.
 */
export function signedPolygonArea(points: Vec2[]): number {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  });
  return sum / 2;
}

export function polygonArea(points: Vec2[]): number {
  return Math.abs(signedPolygonArea(points));
}

export type Winding = 'clockwise' | 'counterclockwise';

/** Winding as seen from above with north up. */
export function polygonWinding(points: Vec2[]): Winding {
  return signedPolygonArea(points) >= 0 ? 'clockwise' : 'counterclockwise';
}

export interface SegmentProjection {
  /** Parameter of the closest point, 0 = `a`, 1 = `b`. */
  t: number;
  point: Vec2;
  distance: number;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): SegmentProjection {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const raw = lengthSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const t = Math.min(1, Math.max(0, raw));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}
