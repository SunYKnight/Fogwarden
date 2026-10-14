import { pointInPolygon, wallSegments } from '../geometry/walls';
import type { LightLevel, Vec2 } from '../model/common';
import type { CreatureSize } from '../model/creature';
import type { Combatant } from '../model/encounter';
import type { BattleMap, OpeningState } from '../model/map';
import type { HeightField } from '../terrain/heightfield';
import { cellRange, FOG_VISIBLE, fogSize, type FogSize } from './fog';
import { RayGrid, type Blocker, type Bounds } from './rayGrid';

/** Eye height above the token's elevation by creature size. */
const EYE_HEIGHT_FT: Record<CreatureSize, number> = {
  tiny: 1,
  small: 2.5,
  medium: 5,
  large: 8,
  huge: 12,
  gargantuan: 18,
};

export type VisionMap = Pick<
  BattleMap,
  'grid' | 'walls' | 'openings' | 'rooms' | 'regions' | 'lights' | 'ambientLight'
>;
export type VisionCombatant = Pick<Combatant, 'id' | 'position' | 'size' | 'senses' | 'visionSource' | 'light'>;

export interface VisionState {
  openingStates: Record<string, OpeningState>;
  combatants: VisionCombatant[];
  cellsPerSquare: number;
}

const DARK = 0;
const DIM = 1;
const BRIGHT = 2;
const MAGICAL_DARK = 3;
const LEVEL: Record<LightLevel, number> = {
  darkness: DARK,
  dim: DIM,
  bright: BRIGHT,
  'magical-darkness': MAGICAL_DARK,
};

// Rays aim a bit above the floor so the cell's own ground never hides it.
const TARGET_LIFT_FT = 0.5;
// Tremorsense needs contact with the ground.
const ON_GROUND_FT = 1;
// Fastest of 5..30 ft measured on 100x100 squares with 300 walls.
const BUCKET_FT = 20;

interface ResolvedLight {
  x: number;
  y: number;
  h: number;
  brightFt: number;
  dimFt: number;
}

type BlockFlag = 'blocksSight' | 'blocksLight';

/**
 * Wall spans that stop sight or light. An opening only spans sill..sill+height of its wall, so the wall
 * parts below the sill and above the opening are added from the wall's own flags.
 */
function visionBlockers(
  map: Pick<BattleMap, 'walls' | 'openings'>,
  terrain: HeightField,
  openingStates: Record<string, OpeningState>,
  flag: BlockFlag,
): Blocker[] {
  const walls = new Map(map.walls.map((w) => [w.id, w]));
  const openings = new Map(map.openings.map((o) => [o.id, o]));
  const result: Blocker[] = [];
  for (const segment of wallSegments(map, terrain, { openingStates, secretAsWall: true })) {
    const wall = walls.get(segment.wallId)!;
    const opening = segment.openingId === null ? undefined : openings.get(segment.openingId);
    const { a, b, bottomFt, topFt } = segment;
    if (segment[flag]) {
      result.push({ a, b, bottomFt, topFt });
    }
    if (opening && wall[flag]) {
      const base: [number, number] = [bottomFt[0] - opening.sillFt, bottomFt[1] - opening.sillFt];
      const wallTop: [number, number] = [base[0] + wall.heightFt, base[1] + wall.heightFt];
      if (opening.sillFt > 0) {
        result.push({ a, b, bottomFt: base, topFt: bottomFt });
      }
      if (opening.sillFt + opening.heightFt < wall.heightFt) {
        result.push({ a, b, bottomFt: topFt, topFt: wallTop });
      }
    }
  }
  return result;
}

/** Floor height under a point: the last elevated room floor, as in `groundHeights`, else the terrain. */
function groundAt(map: VisionMap, terrain: HeightField, p: Vec2): number {
  const room = map.rooms.findLast((r) => r.floorFt !== null && pointInPolygon(p, r.polygon));
  return room?.floorFt ?? terrain.sample(p.x, p.y);
}

function polygonCells(polygon: Vec2[], size: FogSize, visit: (index: number) => void): void {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const range = cellRange(size, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  for (let row = range.row0; row <= range.row1; row++) {
    for (let col = range.col0; col <= range.col1; col++) {
      if (pointInPolygon({ x: (col + 0.5) * size.cellFt, y: (row + 0.5) * size.cellFt }, polygon)) {
        visit(row * size.cellsX + col);
      }
    }
  }
}

/** Floor height per cell centre: elevated room floors over the terrain. */
function groundHeights(map: VisionMap, terrain: HeightField, size: FogSize): Float32Array {
  const ground = new Float32Array(size.cellsX * size.cellsY);
  for (let i = 0; i < ground.length; i++) {
    ground[i] = terrain.sample(
      ((i % size.cellsX) + 0.5) * size.cellFt,
      (Math.floor(i / size.cellsX) + 0.5) * size.cellFt,
    );
  }
  for (const room of map.rooms) {
    const floor = room.floorFt;
    if (floor !== null) {
      polygonCells(room.polygon, size, (i) => (ground[i] = floor));
    }
  }
  return ground;
}

/**
 * Enabled lights at their current place plus lights combatants carry; lights carried by an unplaced or absent
 * combatant are skipped.
 */
function resolveLights(map: VisionMap, combatants: VisionCombatant[]): ResolvedLight[] {
  const fixed = map.lights.flatMap((light) => {
    const carrier = light.attachedTo === null ? null : combatants.find((c) => c.id === light.attachedTo);
    const position = carrier ? carrier.position : light.attachedTo === null ? light.position : null;
    const lift = carrier ? EYE_HEIGHT_FT[carrier.size] : 0;
    return light.enabled && position
      ? [{ x: position.x, y: position.y, h: position.elevationFt + lift, brightFt: light.brightFt, dimFt: light.dimFt }]
      : [];
  });
  const carried = combatants.flatMap(({ light, position, size }): ResolvedLight[] =>
    light && position
      ? [
          {
            x: position.x,
            y: position.y,
            h: position.elevationFt + EYE_HEIGHT_FT[size],
            brightFt: light.brightFt,
            dimFt: light.dimFt,
          },
        ]
      : [],
  );
  return [...fixed, ...carried];
}

/**
 * Light level per cell. Light regions replace the ambient level (a dark cellar under daylight), magical
 * darkness wins over everything, and lights raise the level where their light reaches unblocked.
 */
function lightLevels(
  map: VisionMap,
  size: FogSize,
  ground: Float32Array,
  lights: ResolvedLight[],
  rays: RayGrid,
): Uint8Array {
  const covering = new Int8Array(ground.length).fill(-1);
  for (const region of map.regions) {
    const level = region.kind === 'light' && region.light !== null ? LEVEL[region.light] : -1;
    if (level >= 0) {
      polygonCells(region.polygon, size, (i) => {
        covering[i] =
          covering[i] === MAGICAL_DARK || level === MAGICAL_DARK ? MAGICAL_DARK : Math.max(covering[i]!, level);
      });
    }
  }
  const levels = new Uint8Array(ground.length);
  for (let i = 0; i < levels.length; i++) {
    levels[i] = covering[i]! >= 0 ? covering[i]! : LEVEL[map.ambientLight];
  }
  // A light without reach brightens nothing, not even its own cell.
  for (const light of lights.filter((l) => l.brightFt + l.dimFt > 0)) {
    const reach = light.brightFt + light.dimFt;
    const { col0, col1, row0, row1 } = cellRange(
      size,
      light.x - reach,
      light.y - reach,
      light.x + reach,
      light.y + reach,
    );
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const i = row * size.cellsX + col;
        const cx = (col + 0.5) * size.cellFt;
        const cy = (row + 0.5) * size.cellFt;
        const d = Math.sqrt((cx - light.x) * (cx - light.x) + (cy - light.y) * (cy - light.y));
        const level = d <= light.brightFt ? BRIGHT : DIM;
        const raises = d <= reach && levels[i] !== MAGICAL_DARK && level > levels[i]!;
        if (raises && !rays.blocked(light.x, light.y, light.h, cx, cy, ground[i]! + TARGET_LIFT_FT)) {
          levels[i] = level;
        }
      }
    }
  }
  return levels;
}

function bounds(map: VisionMap, blockers: Blocker[], points: Vec2[]): Bounds {
  const xs = [0, map.grid.squaresX * map.grid.feetPerSquare, ...points.map((p) => p.x)];
  const ys = [0, map.grid.squaresY * map.grid.feetPerSquare, ...points.map((p) => p.y)];
  for (const b of blockers) {
    xs.push(b.a.x, b.b.x);
    ys.push(b.a.y, b.b.y);
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Cells each vision source sees now (FOG_VISIBLE, else 0) by combatant id, row-major from the north-west
 * corner at `cellsPerSquare` cells per grid square. A cell is seen when the ray from the source's eye to the
 * cell passes walls and terrain and the source can perceive the cell's light level at that distance. Light
 * is shared: a torch carried by one source lights cells for every source that has line of sight to them.
 */
export function computeVisibility(
  map: VisionMap,
  terrain: HeightField,
  state: VisionState,
): Map<string, Uint8Array<ArrayBuffer>> {
  const size = fogSize(map.grid, state.cellsPerSquare);
  const count = size.cellsX * size.cellsY;
  const ground = groundHeights(map, terrain, size);
  const lights = resolveLights(map, state.combatants);
  const sources = state.combatants.filter((c) => c.visionSource && c.position);
  const sightBlockers = visionBlockers(map, terrain, state.openingStates, 'blocksSight');
  const lightBlockers = visionBlockers(map, terrain, state.openingStates, 'blocksLight');
  const points = [...lights, ...sources.map((c) => c.position!)];
  const sight = new RayGrid(bounds(map, sightBlockers, points), BUCKET_FT, terrain, sightBlockers);
  const light = new RayGrid(bounds(map, lightBlockers, points), BUCKET_FT, terrain, lightBlockers);
  const levels = lightLevels(map, size, ground, lights, light);
  const bySource = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const source of sources) {
    const visible = new Uint8Array(count);
    const { x, y, elevationFt } = source.position!;
    const eye = elevationFt + EYE_HEIGHT_FT[source.size];
    // A missing or 0 ft sense must not cover the viewer's own cell.
    const darkvision = source.senses.darkvision || -1;
    const blindsight = source.senses.blindsight || -1;
    const truesight = source.senses.truesight || -1;
    const onGround = elevationFt - groundAt(map, terrain, { x, y }) <= ON_GROUND_FT;
    const tremorsense = onGround ? source.senses.tremorsense || -1 : -1;
    for (let i = 0; i < count; i++) {
      const cx = ((i % size.cellsX) + 0.5) * size.cellFt;
      const cy = (Math.floor(i / size.cellsX) + 0.5) * size.cellFt;
      const d = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y));
      const level = levels[i];
      const perceived =
        blindsight >= d ||
        tremorsense >= d ||
        level === BRIGHT ||
        level === DIM ||
        (level === DARK && (darkvision >= d || truesight >= d)) ||
        (level === MAGICAL_DARK && truesight >= d);
      if (perceived && !sight.blocked(x, y, eye, cx, cy, ground[i]! + TARGET_LIFT_FT)) {
        visible[i] = FOG_VISIBLE;
      }
    }
    bySource.set(source.id, visible);
  }
  return bySource;
}
