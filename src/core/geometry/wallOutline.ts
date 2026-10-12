import type { Vec2 } from '../model/common';
import type { Wall } from '../model/map';
import { distance2, lerp2 } from './walls';

/** The two wall faces at one point of the centerline; left/right as seen walking along the wall. */
export interface WallCorner {
  left: Vec2;
  right: Vec2;
}

// Caps miter length at sharp angles so a spike never reaches far out.
const MITER_LIMIT = 4;
const JOIN_EPSILON_FT = 1e-3;
const END_EPSILON = 1e-6;

function direction(from: Vec2, to: Vec2): Vec2 {
  const length = distance2(from, to);
  return length === 0 ? { x: 0, y: 0 } : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** Offsets a vertex by half the thickness along the bisector of the adjacent segment normals. */
function miter(vertex: Vec2, incoming: Vec2, outgoing: Vec2, half: number): WallCorner {
  const dIn = incoming.x === 0 && incoming.y === 0 ? outgoing : incoming;
  const dOut = outgoing.x === 0 && outgoing.y === 0 ? dIn : outgoing;
  // Left of a direction with y pointing south is (d.y, -d.x).
  const n0 = { x: dIn.y, y: -dIn.x };
  const sum = { x: n0.x + dOut.y, y: n0.y - dOut.x };
  const length = Math.hypot(sum.x, sum.y);
  const m = length < 1e-9 ? n0 : { x: sum.x / length, y: sum.y / length };
  const scale = half / Math.max(m.x * n0.x + m.y * n0.y, 1 / MITER_LIMIT);
  return {
    left: { x: vertex.x + m.x * scale, y: vertex.y + m.y * scale },
    right: { x: vertex.x - m.x * scale, y: vertex.y - m.y * scale },
  };
}

/**
 * Point next to `end` on the single other open wall that ends there, so two walls meeting
 * end-to-end join like one polyline; null for free ends and junctions of three or more walls.
 */
function joinedNeighbour(wall: Wall, end: Vec2, others: Wall[]): Vec2 | null {
  const matches = others
    .filter((o) => o.id !== wall.id && !(o.closed && o.points.length > 2))
    .flatMap((o) => {
      const first = o.points[0]!;
      const last = o.points[o.points.length - 1]!;
      return [
        ...(distance2(first, end) < JOIN_EPSILON_FT ? [o.points[1]!] : []),
        ...(distance2(last, end) < JOIN_EPSILON_FT ? [o.points[o.points.length - 2]!] : []),
      ];
    });
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Mitered face points for every vertex of a wall. Closed walls miter all vertices; open walls
 * miter inner vertices and ends that meet exactly one other open wall end, other ends are square.
 */
export function wallCorners(wall: Wall, others: Wall[] = []): WallCorner[] {
  const points = wall.points;
  const n = points.length;
  const closed = wall.closed && n > 2;
  const half = wall.thicknessFt / 2;
  return points.map((vertex, i) => {
    const prev = i > 0 ? points[i - 1]! : closed ? points[n - 1]! : joinedNeighbour(wall, vertex, others);
    const next = i < n - 1 ? points[i + 1]! : closed ? points[0]! : joinedNeighbour(wall, vertex, others);
    const incoming = prev ? direction(prev, vertex) : direction(vertex, next!);
    const outgoing = next ? direction(vertex, next) : incoming;
    return miter(vertex, incoming, outgoing, half);
  });
}

/**
 * Face points across the wall at parameter `t` of segment `segment`: mitered at the segment's
 * vertices, square anywhere in between (opening jambs).
 */
export function wallSection(wall: Wall, corners: WallCorner[], segment: number, t: number): WallCorner {
  const n = wall.points.length;
  const a = wall.points[segment]!;
  const b = wall.points[(segment + 1) % n]!;
  const d = direction(a, b);
  const center = lerp2(a, b, t);
  const half = wall.thicknessFt / 2;
  const square = {
    left: { x: center.x + d.y * half, y: center.y - d.x * half },
    right: { x: center.x - d.y * half, y: center.y + d.x * half },
  };
  const atStart = t <= END_EPSILON ? corners[segment]! : square;
  return t >= 1 - END_EPSILON ? corners[(segment + 1) % n]! : atStart;
}

/**
 * Outline rings of a wall seen from above: one ring for open walls, outer and inner ring for
 * closed walls.
 */
export function wallOutline(wall: Wall, others: Wall[] = []): Vec2[][] {
  const corners = wallCorners(wall, others);
  const left = corners.map((c) => c.left);
  const right = corners.map((c) => c.right);
  return wall.closed && wall.points.length > 2 ? [left, right] : [[...left, ...right.reverse()]];
}
