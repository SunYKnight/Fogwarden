import { closestPointOnSegment } from '../geometry/polygon';
import { distance2, wallSegmentEnds } from '../geometry/walls';
import { newId, type Vec2 } from '../model/common';
import type { BattleMap, Opening, OpeningKind, OpeningState, Wall } from '../model/map';

/** Height and blocking of imported walls; joined polylines never mix profiles. */
export type WallProfile = Pick<Wall, 'heightFt' | 'thicknessFt' | 'blocksSight' | 'blocksMovement' | 'blocksLight'>;

/** Full-height wall that blocks everything, as map makers draw room walls. */
export const FULL_WALL: WallProfile = {
  heightFt: 10,
  thicknessFt: 1,
  blocksSight: true,
  blocksMovement: true,
  blocksLight: true,
};

/** A polyline in map feet as the source drew it. */
export interface SourceWall {
  points: Vec2[];
  profile: WallProfile;
}

/** A door or window between two points in map feet, sitting in a wall of `profile`. */
export interface SourcePortal {
  a: Vec2;
  b: Vec2;
  kind: OpeningKind;
  state: OpeningState;
  secret: boolean;
  profile: WallProfile;
}

export type MapStructures = Pick<BattleMap, 'walls' | 'openings'>;

// Exports round to fractions of a square; closer ends are the same corner.
const SAME_POINT_FT = 0.05;
// Vertices this close to the line through their neighbours add no shape.
const COLINEAR_FT = 0.05;
// Portal ends may sit this far off the wall line and still belong to it.
const ON_WALL_FT = 0.5;

const OPENING_SIZE: Record<OpeningKind, Pick<Opening, 'heightFt' | 'sillFt'>> = {
  door: { heightFt: 7, sillFt: 0 },
  window: { heightFt: 3, sillFt: 3 },
  portcullis: { heightFt: 8, sillFt: 0 },
  'arrow-slit': { heightFt: 3, sillFt: 3 },
};

interface ChainEnd {
  chain: number;
  atStart: boolean;
}

function pointKey(p: Vec2): string {
  return `${Math.round(p.x / SAME_POINT_FT)},${Math.round(p.y / SAME_POINT_FT)}`;
}

function withoutRepeats(points: Vec2[]): Vec2[] {
  return points.filter((p, i) => i === 0 || distance2(points[i - 1]!, p) > SAME_POINT_FT);
}

/** The single free chain end at `point`, when exactly two ends meet there. */
function partner(ends: Map<string, ChainEnd[]>, used: Set<number>, point: Vec2): ChainEnd | null {
  const here = ends.get(pointKey(point)) ?? [];
  const free = here.filter((e) => !used.has(e.chain));
  return here.length === 2 && free.length === 1 ? free[0]! : null;
}

/**
 * Joins polylines whose ends meet. Only points where exactly two ends meet are joined, so
 * T-junctions and crossings keep separate walls, as the editor draws them.
 */
function joinChains(chains: Vec2[][]): Vec2[][] {
  const ends = new Map<string, ChainEnd[]>();
  const addEnd = (p: Vec2, end: ChainEnd) => ends.set(pointKey(p), [...(ends.get(pointKey(p)) ?? []), end]);
  chains.forEach((c, i) => {
    addEnd(c[0]!, { chain: i, atStart: true });
    addEnd(c.at(-1)!, { chain: i, atStart: false });
  });
  const used = new Set<number>();
  const joined: Vec2[][] = [];
  chains.forEach((chain, i) => {
    if (!used.has(i)) {
      used.add(i);
      const forward = [...chain];
      let next = partner(ends, used, forward.at(-1)!);
      while (next) {
        used.add(next.chain);
        const appended = chains[next.chain]!;
        forward.push(...(next.atStart ? appended : [...appended].reverse()).slice(1));
        next = partner(ends, used, forward.at(-1)!);
      }
      const backward: Vec2[][] = [];
      let head = forward[0]!;
      next = partner(ends, used, head);
      while (next) {
        used.add(next.chain);
        const prepended = chains[next.chain]!;
        const piece = next.atStart ? [...prepended].reverse() : prepended;
        backward.push(piece.slice(0, -1));
        head = piece[0]!;
        next = partner(ends, used, head);
      }
      joined.push([...backward.reverse().flat(), ...forward]);
    }
  });
  return joined;
}

/** Drops vertices that lie on the line between their kept neighbours. */
function dropColinear(points: Vec2[]): Vec2[] {
  const kept = [points[0]!];
  let skipped: Vec2[] = [];
  points.slice(1, -1).forEach((p, i) => {
    const next = points[i + 2]!;
    const candidates = [...skipped, p];
    const straight = candidates.every((q) => closestPointOnSegment(q, kept.at(-1)!, next).distance < COLINEAR_FT);
    if (straight) {
      skipped = candidates;
    } else {
      kept.push(p);
      skipped = [];
    }
  });
  kept.push(points.at(-1)!);
  return kept;
}

/** Wall points and closedness of a joined chain, with redundant vertices removed. */
function simplify(chain: Vec2[]): { points: Vec2[]; closed: boolean } {
  const points = withoutRepeats(chain);
  const loop = points.length > 3 && distance2(points[0]!, points.at(-1)!) <= SAME_POINT_FT;
  let result = { points: dropColinear(points), closed: false };
  if (loop) {
    // A rotated ring lets a colinear start vertex be dropped too.
    const ring = dropColinear(points.slice(0, -1).concat(points[0]!)).slice(0, -1);
    const wrapped = dropColinear([ring.at(-1)!, ...ring, ring[0]!]).slice(1, -1);
    result = { points: wrapped.length >= 3 ? wrapped : ring, closed: true };
  }
  return result;
}

interface SegmentHit {
  wall: Wall;
  segment: number;
  t: number;
  error: number;
}

/** The wall segment both portal ends lie on, if any. */
function segmentUnder(walls: Wall[], a: Vec2, b: Vec2): SegmentHit | null {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return walls
    .flatMap((wall) =>
      wallSegmentEnds(wall).map(([p, q], segment) => {
        const error = Math.max(closestPointOnSegment(a, p, q).distance, closestPointOnSegment(b, p, q).distance);
        return { wall, segment, t: closestPointOnSegment(mid, p, q).t, error };
      }),
    )
    .reduce<SegmentHit | null>(
      (best, hit) => (hit.error <= ON_WALL_FT && (best === null || hit.error < best.error) ? hit : best),
      null,
    );
}

/**
 * Walls and openings from source polylines and portals. A portal whose ends lie on a source
 * wall becomes an opening there; any other portal becomes a wall piece of its own that joins
 * the walls meeting its ends, so a door between two wall runs yields one continuous wall.
 */
export function buildStructures(sourceWalls: SourceWall[], portals: SourcePortal[]): MapStructures {
  const raw = sourceWalls.map((w) => ({ ...w, points: withoutRepeats(w.points) })).filter((w) => w.points.length >= 2);
  const rawWalls = raw.map((w) => toWall(w.points, false, w.profile));
  const bridging = portals.filter((p) => segmentUnder(rawWalls, p.a, p.b) === null);
  const groups = new Map<string, { profile: WallProfile; chains: Vec2[][] }>();
  const add = (profile: WallProfile, chain: Vec2[]) => {
    const key = [
      profile.heightFt,
      profile.thicknessFt,
      profile.blocksSight,
      profile.blocksMovement,
      profile.blocksLight,
    ]
      .map(String)
      .join('/');
    const group = groups.get(key) ?? { profile, chains: [] };
    group.chains.push(chain);
    groups.set(key, group);
  };
  raw.forEach((w) => add(w.profile, w.points));
  bridging.filter((p) => distance2(p.a, p.b) > SAME_POINT_FT).forEach((p) => add(p.profile, [p.a, p.b]));
  const walls = [...groups.values()].flatMap(({ profile, chains }) =>
    joinChains(chains).map((chain) => {
      const { points, closed } = simplify(chain);
      return toWall(points, closed, profile);
    }),
  );
  const openings = portals.flatMap((p) => {
    const hit = segmentUnder(walls, p.a, p.b);
    return hit ? [toOpening(p, hit)] : [];
  });
  return { walls, openings };
}

function toWall(points: Vec2[], closed: boolean, profile: WallProfile): Wall {
  return { id: newId(), points, closed, baseFt: null, material: 'projected', ...profile };
}

function toOpening(portal: SourcePortal, hit: SegmentHit): Opening {
  const size = OPENING_SIZE[portal.kind];
  const heightFt = Math.min(size.heightFt, hit.wall.heightFt - size.sillFt);
  return {
    id: newId(),
    wallId: hit.wall.id,
    segment: hit.segment,
    t: hit.t,
    widthFt: Math.max(distance2(portal.a, portal.b), SAME_POINT_FT),
    heightFt: heightFt > 0 ? heightFt : hit.wall.heightFt,
    sillFt: heightFt > 0 ? size.sillFt : 0,
    kind: portal.kind,
    state: portal.state,
    secret: portal.secret,
  };
}
