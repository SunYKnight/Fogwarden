import type { Vec2 } from '../model/common';
import type { Opening, Wall } from '../model/map';
import { closestPointOnSegment, polygonArea } from './polygon';
import { pointInPolygon, wallSegmentEnds } from './walls';

/** Where a point lies closest to a wall: the values an opening needs to sit there. */
export interface WallHit {
  wallId: string;
  segment: number;
  t: number;
  point: Vec2;
  distanceFt: number;
}

/** Closest wall segment to a point within `maxDistanceFt`, or null. */
export function nearestWallSegment(point: Vec2, walls: Wall[], maxDistanceFt = Infinity): WallHit | null {
  return walls
    .flatMap((wall) =>
      wallSegmentEnds(wall).map(([a, b], segment) => {
        const projection = closestPointOnSegment(point, a, b);
        return { wallId: wall.id, segment, t: projection.t, point: projection.point, distanceFt: projection.distance };
      }),
    )
    .reduce<WallHit | null>(
      (best, hit) =>
        hit.distanceFt <= maxDistanceFt && (best === null || hit.distanceFt < best.distanceFt) ? hit : best,
      null,
    );
}

/**
 * Closed wall a room can be created from: the point is inside its centerline polygon or on the wall
 * body. The smallest such wall wins so a click in an inner room does not pick the outer building.
 */
export function closedWallAt(point: Vec2, walls: Wall[]): Wall | null {
  return walls
    .filter((wall) => wall.closed && wall.points.length > 2)
    .filter(
      (wall) =>
        pointInPolygon(point, wall.points) ||
        (nearestWallSegment(point, [wall])?.distanceFt ?? Infinity) <= wall.thicknessFt / 2,
    )
    .reduce<Wall | null>(
      (best, wall) => (best === null || polygonArea(wall.points) < polygonArea(best.points) ? wall : best),
      null,
    );
}

/** Walls and openings that replace a wall and its openings after an edit. */
export interface WallSplit {
  walls: Wall[];
  openings: Opening[];
}

/**
 * Splits a wall at a vertex. A closed wall opens there (the vertex becomes both ends); an open
 * wall becomes two walls, the second one gets `newWallId`. Openings keep their place on the wall.
 */
export function splitWallAtVertex(wall: Wall, openings: Opening[], vertex: number, newWallId: string): WallSplit {
  const n = wall.points.length;
  const ring = wall.closed && n > 2;
  if (vertex < 0 || vertex >= n || (!ring && (vertex === 0 || vertex === n - 1))) {
    throw new Error('A wall can only be split at one of its vertices; open walls at an inner one');
  }
  const own = openings.filter((o) => o.wallId === wall.id);
  const reopened: WallSplit = {
    walls: [{ ...wall, closed: false, points: [...wall.points.slice(vertex), ...wall.points.slice(0, vertex + 1)] }],
    openings: own.map((o) => ({ ...o, segment: (o.segment - vertex + n) % n })),
  };
  const halves: WallSplit = {
    walls: [
      { ...wall, points: wall.points.slice(0, vertex + 1) },
      { ...wall, id: newWallId, points: wall.points.slice(vertex) },
    ],
    openings: own.map((o) => (o.segment < vertex ? o : { ...o, wallId: newWallId, segment: o.segment - vertex })),
  };
  return ring ? reopened : halves;
}
