import { bytesToBase64 } from '../binary';
import { distance2, lerp2, wallPieces } from '../geometry/walls';
import type { LightLevel, Vec2 } from '../model/common';
import type { BattleMap, OpeningKind, Wall } from '../model/map';
import { FULL_WALL } from '../import/mapStructures';

/** Battlemap picture covering exactly the map's squares from its north-west corner. */
export interface UvttImage {
  bytes: Uint8Array;
  pxPerSquare: number;
}

interface UvttPortal {
  position: Vec2;
  bounds: [Vec2, Vec2];
  rotation: number;
  closed: boolean;
  freestanding: boolean;
}

// Universal VTT has no light levels; the tint's brightness tells importers.
const AMBIENT_COLOR: Record<LightLevel, string> = {
  bright: 'ffffffff',
  dim: 'ff666666',
  darkness: 'ff1a1a1a',
  'magical-darkness': 'ff000000',
};

// Readers take an open portal for one that lets sight through.
const PORTAL_CLOSED: Record<OpeningKind, boolean> = {
  door: true,
  window: false,
  portcullis: false,
  'arrow-slit': false,
};

const SAME_POINT_FT = 1e-6;

/** Sight-blocking runs of a wall, broken at its openings, plus one portal per opening. */
function wallLines(map: BattleMap, wall: Wall, toSquares: (p: Vec2) => Vec2) {
  const lines: Vec2[][] = [];
  const portals: UvttPortal[] = [];
  let current: Vec2[] = [];
  const pieces = wallPieces({ walls: [wall], openings: map.openings });
  for (const piece of pieces) {
    const start = lerp2(piece.a, piece.b, piece.t0);
    const end = lerp2(piece.a, piece.b, piece.t1);
    if (piece.opening) {
      lines.push(current);
      current = [];
      const [a, b] = [toSquares(start), toSquares(end)];
      portals.push({
        position: lerp2(a, b, 0.5),
        bounds: [a, b],
        rotation: Math.atan2(b.y - a.y, b.x - a.x),
        closed: PORTAL_CLOSED[piece.opening.kind],
        freestanding: false,
      });
    } else {
      const last = current.at(-1);
      current.push(...(last && distance2(last, start) <= SAME_POINT_FT ? [end] : [start, end]));
    }
  }
  lines.push(current);
  // A closed wall's last run continues into its first one at the start point.
  const wraps = wall.closed && lines.length > 1 && !pieces[0]!.opening && !pieces.at(-1)!.opening;
  const joined = wraps ? [[...lines.at(-1)!, ...lines[0]!.slice(1)], ...lines.slice(1, -1)] : lines;
  return { lines: joined.filter((l) => l.length >= 2).map((l) => l.map(toSquares)), portals };
}

/**
 * Universal VTT (`.dd2vtt`) for other virtual tabletops: sight-blocking walls (full height as
 * `line_of_sight`, lower ones as `objects_line_of_sight`), openings as portals, enabled map lights
 * and the ambient light. Positions are squares from the map's north-west corner.
 */
export function formatUvtt(map: BattleMap, image: UvttImage): string {
  const { feetPerSquare, squaresX, squaresY } = map.grid;
  const toSquares = (p: Vec2): Vec2 => ({ x: p.x / feetPerSquare, y: p.y / feetPerSquare });
  const runs = map.walls.filter((w) => w.blocksSight).map((wall) => ({ wall, ...wallLines(map, wall, toSquares) }));
  const full = runs.filter((r) => r.wall.heightFt >= FULL_WALL.heightFt);
  const low = runs.filter((r) => r.wall.heightFt < FULL_WALL.heightFt);
  const document = {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: squaresX, y: squaresY },
      pixels_per_grid: image.pxPerSquare,
    },
    line_of_sight: full.flatMap((r) => r.lines),
    objects_line_of_sight: low.flatMap((r) => r.lines),
    portals: runs.flatMap((r) => r.portals),
    environment: { baked_lighting: false, ambient_light: AMBIENT_COLOR[map.ambientLight] },
    lights: map.lights
      .filter((l) => l.enabled && l.attachedTo === null)
      .map((l) => ({
        position: toSquares(l.position),
        range: (l.brightFt + l.dimFt) / feetPerSquare,
        intensity: 1,
        color: `ff${l.color.slice(1)}`,
        shadows: true,
      })),
    image: bytesToBase64(image.bytes),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
