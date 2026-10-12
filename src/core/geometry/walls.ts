import type { Vec2 } from '../model/common';
import type { BattleMap, Opening, OpeningState, Wall } from '../model/map';
import type { HeightField } from '../terrain/heightfield';

/**
 * Straight piece of a wall between two map plane points, with what it blocks.
 * Openings split their wall segment into solid parts and one opening part.
 */
export interface WallSegment {
  a: Vec2;
  b: Vec2;
  wallId: string;
  /** Set when this piece is (part of) an opening. */
  openingId: string | null;
  blocksSight: boolean;
  blocksMovement: boolean;
  blocksLight: boolean;
  /** Absolute feet of the segment's bottom and top edge at `a` and `b`. */
  bottomFt: [number, number];
  topFt: [number, number];
}

export interface WallSegmentOptions {
  /** Live door states from the encounter; missing ids use the map's state. */
  openingStates?: Record<string, OpeningState>;
  /** Players never see secret doors as doors: they stay solid wall until opened. */
  secretAsWall?: boolean;
}

/** Index pairs of a wall's segments; closed walls get the closing segment last. */
export function wallSegmentEnds(wall: Wall): [Vec2, Vec2][] {
  const ends: [Vec2, Vec2][] = [];
  for (let i = 0; i < wall.points.length - 1; i++) {
    ends.push([wall.points[i]!, wall.points[i + 1]!]);
  }
  if (wall.closed && wall.points.length > 2) {
    ends.push([wall.points[wall.points.length - 1]!, wall.points[0]!]);
  }
  return ends;
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Absolute foot elevation of a wall's base at a point on it. */
export function wallBaseAt(wall: Wall, p: Vec2, terrain: HeightField | null): number {
  return wall.baseFt ?? terrain?.sample(p.x, p.y) ?? 0;
}

/** Whether an opening currently lets things through, by kind and state. */
function openingBlocks(opening: Opening, state: OpeningState, secretAsWall: boolean) {
  const shut = state !== 'open';
  const hiddenSecret = secretAsWall && opening.secret && shut;
  const seeThrough = opening.kind === 'window' || opening.kind === 'portcullis' || opening.kind === 'arrow-slit';
  return {
    blocksSight: hiddenSecret || (shut && !seeThrough),
    blocksMovement: hiddenSecret || shut || opening.kind === 'window' || opening.kind === 'arrow-slit',
    blocksLight: hiddenSecret || (shut && !seeThrough),
  };
}

/** Part of one wall segment between two cut parameters; `opening` is set for the part an opening fills. */
export interface WallPiece {
  wall: Wall;
  segment: number;
  /** Segment end points; the piece spans `t0..t1` between them. */
  a: Vec2;
  b: Vec2;
  t0: number;
  t1: number;
  opening: Opening | null;
}

/**
 * Splits every wall segment at its openings. Openings are placed by `segment` + `t` and clamped to
 * their segment; overlapping openings on one segment are applied in order of `t`.
 */
export function wallPieces(map: Pick<BattleMap, 'walls' | 'openings'>): WallPiece[] {
  const result: WallPiece[] = [];
  for (const wall of map.walls) {
    const openings = map.openings.filter((o) => o.wallId === wall.id);
    wallSegmentEnds(wall).forEach(([a, b], segment) => {
      const length = distance2(a, b);
      const cuts = openings
        .filter((o) => o.segment === segment && length > 0)
        .map((o) => {
          const half = Math.min(o.widthFt, length) / 2 / length;
          const t0 = Math.max(0, Math.min(1 - 2 * half, o.t - half));
          return { opening: o, t0, t1: t0 + 2 * half };
        })
        .sort((x, y) => x.t0 - y.t0);
      let cursor = 0;
      const push = (t0: number, t1: number, opening: Opening | null) =>
        result.push({ wall, segment, a, b, t0, t1, opening });
      for (const cut of cuts) {
        const start = Math.max(cursor, cut.t0);
        if (start > cursor) push(cursor, start, null);
        if (cut.t1 > start) push(start, cut.t1, cut.opening);
        cursor = Math.max(cursor, cut.t1);
      }
      if (cursor < 1) push(cursor, 1, null);
    });
  }
  return result;
}

/** All wall pieces of a map with what they block and their bottom/top heights. */
export function wallSegments(
  map: Pick<BattleMap, 'walls' | 'openings'>,
  terrain: HeightField | null,
  options: WallSegmentOptions = {},
): WallSegment[] {
  return wallPieces(map).map(({ wall, a, b, t0, t1, opening }) => {
    const pa = lerp2(a, b, t0);
    const pb = lerp2(a, b, t1);
    const ba = wallBaseAt(wall, pa, terrain);
    const bb = wallBaseAt(wall, pb, terrain);
    const state = opening ? (options.openingStates?.[opening.id] ?? opening.state) : 'closed';
    const blocks = opening
      ? openingBlocks(opening, state, options.secretAsWall ?? false)
      : { blocksSight: wall.blocksSight, blocksMovement: wall.blocksMovement, blocksLight: wall.blocksLight };
    return {
      a: pa,
      b: pb,
      wallId: wall.id,
      openingId: opening?.id ?? null,
      ...blocks,
      bottomFt: opening ? [ba + opening.sillFt, bb + opening.sillFt] : [ba, bb],
      topFt: opening
        ? [ba + opening.sillFt + opening.heightFt, bb + opening.sillFt + opening.heightFt]
        : [ba + wall.heightFt, bb + wall.heightFt],
    };
  });
}

/** Even-odd rule; points exactly on an edge count as inside on some edges only. */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const crosses =
      pi.y > point.y !== pj.y > point.y && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Intersection parameter t along p->q with segment a->b, or null when they do not cross. */
export function segmentIntersection(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  const t = denom === 0 ? -1 : ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
  const u = denom === 0 ? -1 : ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
