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

interface CellEdge {
  from: Vec2;
  to: Vec2;
}

const cellKey = (p: Vec2) => `${p.x},${p.y}`;

/** Outgoing edge at a vertex; at a pinch (two cells touching corners) the left turn keeps loops apart. */
function nextEdge(candidates: CellEdge[], incoming: CellEdge): CellEdge | undefined {
  const dx = incoming.to.x - incoming.from.x;
  const dy = incoming.to.y - incoming.from.y;
  const turn = (e: CellEdge) => dx * (e.to.y - e.from.y) - dy * (e.to.x - e.from.x);
  return [...candidates].sort((a, b) => turn(b) - turn(a))[0];
}

/** Drops vertices of a closed axis-aligned loop that lie on a straight run. */
function cornersOnly(loop: Vec2[]): Vec2[] {
  return loop.filter((p, i) => {
    const prev = loop[(i + loop.length - 1) % loop.length]!;
    const next = loop[(i + 1) % loop.length]!;
    return (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x) !== 0;
  });
}

/**
 * Outline of a set of unit cells on integer coordinates (cell `{x, y}` covers x..x+1, y..y+1):
 * the corners of the largest connected outline; holes are left out.
 */
export function cellOutline(cells: Vec2[]): Vec2[] {
  const filled = new Set(cells.map(cellKey));
  const edges: CellEdge[] = [];
  filled.forEach((key) => {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const sides: [Vec2, Vec2, Vec2][] = [
      [
        { x, y: y - 1 },
        { x, y },
        { x: x + 1, y },
      ],
      [
        { x: x + 1, y },
        { x: x + 1, y },
        { x: x + 1, y: y + 1 },
      ],
      [
        { x, y: y + 1 },
        { x: x + 1, y: y + 1 },
        { x, y: y + 1 },
      ],
      [
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y },
      ],
    ];
    sides.forEach(([neighbour, from, to]) => {
      if (!filled.has(cellKey(neighbour))) edges.push({ from, to });
    });
  });
  const outgoing = new Map<string, CellEdge[]>();
  edges.forEach((e) => outgoing.set(cellKey(e.from), [...(outgoing.get(cellKey(e.from)) ?? []), e]));
  const used = new Set<CellEdge>();
  const loops: Vec2[][] = [];
  edges.forEach((first) => {
    if (!used.has(first)) {
      const loop: Vec2[] = [];
      let edge: CellEdge | undefined = first;
      while (edge && !used.has(edge)) {
        used.add(edge);
        loop.push(edge.from);
        const current: CellEdge = edge;
        edge = nextEdge(
          (outgoing.get(cellKey(current.to)) ?? []).filter((e) => !used.has(e)),
          current,
        );
      }
      loops.push(loop);
    }
  });
  // Outer outlines run counter-clockwise in these coordinates, holes clockwise.
  const outer = loops.filter((l) => signedPolygonArea(l) > 0).sort((a, b) => polygonArea(b) - polygonArea(a))[0];
  return outer ? cornersOnly(outer) : [];
}
