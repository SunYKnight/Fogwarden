import { closestPointOnSegment } from '../geometry/polygon';
import { newId, type Vec2 } from '../model/common';
import type { Grid, Room } from '../model/map';
import { damMargin, type DamProject, type DamSpan } from './damProject';
import type { ImportedContent, StructureSources } from './importedMap';
import { buildStructures, FULL_WALL, type SourcePortal, type SourceWall, type WallProfile } from './mapStructures';

// Export lines this close to a scaled building wall are that wall.
const MATCH_FT = 0.75;
// Far export points count this much in the fit, so other walls do not pull.
const FIT_CAP_FT = 1;
const SCALE_MIN = 0.95;
const SCALE_MAX = 1.15;
const SCALE_STEP = 0.001;
const PILLAR_FT = 1.5;
const EPSILON = 1e-6;
const UPPER_FLOORS_NOTE = 'Upper floors of the Dungeon Alchemist project are not imported yet.';

/**
 * Colinear wall pieces that touch become one run, so an opening several pieces wide lies on
 * one segment and walls meet only at real corners.
 */
export function wallRuns(pieces: DamSpan[]): DamSpan[] {
  const lines = new Map<string, { a: Vec2; u: Vec2; spans: [number, number][] }>();
  pieces.forEach(({ a, b }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const raw = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const u = raw.x > EPSILON || (Math.abs(raw.x) <= EPSILON && raw.y > 0) ? raw : { x: -raw.x, y: -raw.y };
    const offset = a.x * u.y - a.y * u.x;
    const key = [u.x, u.y, offset].map((v) => Math.round(v / EPSILON)).join(',');
    const ta = a.x * u.x + a.y * u.y;
    const tb = b.x * u.x + b.y * u.y;
    const line = lines.get(key) ?? { a, u, spans: [] };
    line.spans.push([Math.min(ta, tb), Math.max(ta, tb)]);
    lines.set(key, line);
  });
  return [...lines.values()].flatMap(({ a, u, spans }) => {
    const base = a.x * u.x + a.y * u.y;
    const at = (t: number) => ({ x: a.x + u.x * (t - base), y: a.y + u.y * (t - base) });
    const merged: [number, number][] = [];
    [...spans]
      .sort((p, q) => p[0] - q[0])
      .forEach(([t0, t1]) => {
        const last = merged.at(-1);
        if (last && t0 <= last[1] + EPSILON) {
          last[1] = Math.max(last[1], t1);
        } else {
          merged.push([t0, t1]);
        }
      });
    return merged.map(([t0, t1]) => ({ a: at(t0), b: at(t1) }));
  });
}

function scaled(p: Vec2, centre: Vec2, scale: number): Vec2 {
  return { x: centre.x + (p.x - centre.x) * scale, y: centre.y + (p.y - centre.y) * scale };
}

function distanceToRuns(p: Vec2, runs: DamSpan[]): number {
  return runs.reduce((best, r) => Math.min(best, closestPointOnSegment(p, r.a, r.b).distance), Infinity);
}

function sourcePoints(sources: StructureSources): Vec2[] {
  return [...sources.walls.flatMap((w) => w.points), ...sources.portals.flatMap((p) => [p.a, p.b])];
}

/**
 * Dungeon Alchemist renders its picture with a perspective camera above the map centre: the
 * ground lies true to the grid, wall tops appear pushed outwards by a common factor, and the
 * exports draw the walls where their tops show. The factor that lays the project's walls best
 * onto the export's lines; 1 without export lines.
 */
export function fitWallTopScale(runs: DamSpan[], sources: StructureSources, centre: Vec2): number {
  const points = sourcePoints(sources);
  const cost = (scale: number) => {
    const apparent = runs.map((r) => ({ a: scaled(r.a, centre, scale), b: scaled(r.b, centre, scale) }));
    return points.reduce((sum, p) => sum + Math.min(distanceToRuns(p, apparent), FIT_CAP_FT), 0);
  };
  const steps = Math.round((SCALE_MAX - SCALE_MIN) / SCALE_STEP);
  const candidates = Array.from({ length: steps + 1 }, (_, i) => SCALE_MIN + i * SCALE_STEP);
  const coarse = candidates.reduce((best, s) => (cost(s) < cost(best) ? s : best), 1);
  // Tenth steps refine the coarse best to under a hundredth of a foot.
  const fine = Array.from({ length: 21 }, (_, i) => coarse + (i - 10) * (SCALE_STEP / 10));
  return points.length > 0 && runs.length > 0 ? fine.reduce((best, s) => (cost(s) < cost(best) ? s : best)) : 1;
}

function pillarSquare(p: Vec2): Vec2[] {
  const h = PILLAR_FT / 2;
  return [
    { x: p.x - h, y: p.y - h },
    { x: p.x + h, y: p.y - h },
    { x: p.x + h, y: p.y + h },
    { x: p.x - h, y: p.y + h },
    { x: p.x - h, y: p.y - h },
  ];
}

/**
 * Walls, openings and rooms of the project's ground level replace the export's walls and doors
 * where both describe the same building; export lines elsewhere stay. The export's doors and
 * windows lying on a project opening decide its kind, since the project only names the model.
 */
export function withDamStructures(
  content: ImportedContent,
  sources: StructureSources,
  project: DamProject,
  grid: Pick<Grid, 'squaresX' | 'squaresY' | 'feetPerSquare'>,
): ImportedContent {
  const { structure } = project;
  const margin = damMargin(project, grid);
  const shift = (p: Vec2) => ({ x: p.x + margin.x * grid.feetPerSquare, y: p.y + margin.y * grid.feetPerSquare });
  const centre = { x: (grid.squaresX * grid.feetPerSquare) / 2, y: (grid.squaresY * grid.feetPerSquare) / 2 };
  const runs = wallRuns(structure.walls.map((w) => ({ a: shift(w.a), b: shift(w.b) })));
  const scale = fitWallTopScale(runs, sources, centre);
  const apparent = runs.map((r) => ({ a: scaled(r.a, centre, scale), b: scaled(r.b, centre, scale) }));
  const covered = (p: Vec2) => distanceToRuns(p, apparent) <= MATCH_FT;
  const coveredSpan = (a: Vec2, b: Vec2) =>
    covered(a) && covered(b) && covered({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const keptWalls: SourceWall[] = sources.walls.flatMap((w) =>
    w.points
      .slice(1)
      .map((b, i) => ({ points: [w.points[i]!, b], profile: w.profile }))
      .filter(({ points: [a, b] }) => !coveredSpan(a!, b!)),
  );
  const exportPortals = sources.portals.filter((p) => coveredSpan(p.a, p.b));
  const wall: WallProfile = { ...FULL_WALL, heightFt: structure.storeyFt };
  const damPortals = structure.openings.map((o): SourcePortal => {
    const a = shift(o.a);
    const b = shift(o.b);
    const [sa, sb] = [scaled(a, centre, scale), scaled(b, centre, scale)];
    const matched = exportPortals.filter(
      (p) => closestPointOnSegment({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 }, sa, sb).distance <= MATCH_FT,
    );
    const isWindow = matched.length > 0 && matched.every((p) => p.kind === 'window');
    const state = matched[0]?.state ?? 'closed';
    return { a, b, kind: isWindow ? 'window' : 'door', state, secret: matched.some((p) => p.secret), profile: wall };
  });
  const pillarProfile: WallProfile = { ...wall, thicknessFt: PILLAR_FT / 2 };
  const pillars = structure.pillars
    .map(shift)
    .filter((p) => distanceToRuns(p, runs) > MATCH_FT)
    .map((p) => ({ points: pillarSquare(p), profile: pillarProfile }));
  const built = buildStructures(
    [...runs.map((r) => ({ points: [r.a, r.b], profile: wall })), ...pillars, ...keptWalls],
    [...damPortals, ...sources.portals.filter((p) => !exportPortals.includes(p))],
  );
  const rooms = structure.rooms
    .filter((polygon) => polygon.length >= 3)
    .map((polygon, i): Room => ({
      id: newId(),
      name: `Room ${content.rooms.length + i + 1}`,
      polygon: polygon.map(shift),
      floorFt: structure.floorFt,
      ceilingFt: structure.storeyFt,
      roof: true,
      roofMaterial: 'wood',
    }));
  const notes =
    structure.otherLevelParts > 0 ? [content.notes, UPPER_FLOORS_NOTE].filter(Boolean).join(' ') : content.notes;
  const hasBuilding = runs.length > 0 || rooms.length > 0;
  return hasBuilding ? { ...content, ...built, rooms: [...content.rooms, ...rooms], notes } : { ...content, notes };
}
