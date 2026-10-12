import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMap, MAP_SCHEMA_VERSION, mapSchema, type BattleMap, type Vec2 } from '../src/core/model';
import { HeightField } from '../src/core/terrain/heightfield';
import { CONTENT_ROOT } from './cli';
import { encodePng } from './png';

/**
 * Builds the shipped sample map `content/maps/sample-chapel`: a ruined chapel in a forest clearing,
 * drawn procedurally (no third-party art), with walls, a door, a window, a roofed room, light and
 * darkness regions, two lights and gentle terrain. Usage: pnpm tsx tools/build-sample.ts
 */
const MAP_ID = 'sample-chapel';
const IMAGE_NAME = 'chapel.png';
const SQUARES_X = 20;
const SQUARES_Y = 16;
const PX = 100;
const FEET = 5;
// Fixed timestamp and seed keep regenerated files identical.
const TIMESTAMP = '2026-10-12T00:00:00.000Z';
const SEED = 1207;

type Color = [number, number, number];

const GRASS_DARK: Color = [74, 98, 46];
const GRASS_LIGHT: Color = [108, 132, 62];
const FOREST_FLOOR: Color = [62, 68, 38];
const DIRT: Color = [128, 102, 70];
const DIRT_DARK: Color = [98, 78, 54];
const FLAG_STONE: Color = [138, 134, 124];
const MORTAR: Color = [78, 74, 68];
const MOSS: Color = [92, 110, 60];
const WALL_STONE: Color = [112, 108, 102];
const WALL_EDGE: Color = [52, 50, 48];
const WOOD: Color = [112, 78, 46];
const WOOD_DARK: Color = [70, 48, 30];
const ALTAR: Color = [176, 170, 158];
const EMBER: Color = [255, 168, 64];
const ASH: Color = [60, 52, 46];
const TREE_LIGHT: Color = [66, 104, 46];
const TREE_DARK: Color = [28, 54, 26];

/** Chapel nave in squares; the walls run along its outline. */
const CHAPEL = { x0: 7, y0: 3, x1: 13, y1: 10 };
/** Open wall polyline in squares; the gap on the east side is the collapsed breach. */
const WALL_POINTS: Vec2[] = [
  { x: 13, y: 6.5 },
  { x: 13, y: 3 },
  { x: 7, y: 3 },
  { x: 7, y: 10 },
  { x: 13, y: 10 },
  { x: 13, y: 8 },
];
const WALL_HALF = 0.22;
const DOOR = { x0: 9.5, x1: 10.5, y: 10 };
const WINDOW = { x: 7, y0: 6.2, y1: 6.8 };
const ALTAR_BOX = { x0: 9.2, y0: 3.5, x1: 10.8, y1: 4.3 };
const CAMPFIRE: Vec2 = { x: 15.5, y: 12.5 };
const PATH: Vec2[] = [
  { x: 10, y: 10.2 },
  { x: 10.3, y: 12 },
  { x: 9.6, y: 14 },
  { x: 10.2, y: 16.3 },
];
const CLEARING = { cx: 10, cy: 8.3, rx: 9, ry: 7.2 };

interface Circle {
  x: number;
  y: number;
  r: number;
  seed: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a: Color, b: Color, t: number): Color => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale = (c: Color, f: number): Color => [c[0] * f, c[1] * f, c[2] * f];

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = smoothstep(0, 1, x - ix);
  const ty = smoothstep(0, 1, y - iy);
  const top = lerp(hash2(ix, iy, seed), hash2(ix + 1, iy, seed), tx);
  const bottom = lerp(hash2(ix, iy + 1, seed), hash2(ix + 1, iy + 1, seed), tx);
  return lerp(top, bottom, ty);
}

function fbm(x: number, y: number, seed: number): number {
  return (valueNoise(x, y, seed) * 4 + valueNoise(x * 2, y * 2, seed + 1) * 2 + valueNoise(x * 4, y * 4, seed + 2)) / 7;
}

/** Distance from p to segment ab and the position along it (squares from a). */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): { dist: number; along: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length));
  return { dist: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), along: t * length };
}

function polylineDistance(p: Vec2, points: Vec2[]): { dist: number; along: number } {
  let best = { dist: Infinity, along: 0 };
  let offset = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const hit = segmentDistance(p, points[i]!, points[i + 1]!);
    if (hit.dist < best.dist) {
      best = { dist: hit.dist, along: offset + hit.along };
    }
    offset += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
  }
  return best;
}

/** 0 in the clearing's middle, 1 on its rim, above 1 in the forest. */
function clearingDistance(x: number, y: number): number {
  return Math.hypot((x - CLEARING.cx) / CLEARING.rx, (y - CLEARING.cy) / CLEARING.ry);
}

function insideChapel(x: number, y: number, margin: number): boolean {
  return x > CHAPEL.x0 - margin && x < CHAPEL.x1 + margin && y > CHAPEL.y0 - margin && y < CHAPEL.y1 + margin;
}

/** Trees on a jittered lattice: dense in the forest ring, a few in the clearing, none on the path. */
function placeTrees(random: () => number): Circle[] {
  const trees: Circle[] = [];
  for (let gy = -1; gy <= SQUARES_Y + 1; gy += 1.3) {
    for (let gx = -1; gx <= SQUARES_X + 1; gx += 1.3) {
      const x = gx + (random() - 0.5) * 1.1;
      const y = gy + (random() - 0.5) * 1.1;
      const d = clearingDistance(x, y) + (random() - 0.5) * 0.12;
      const keep = d > 0.98 || (d > 0.72 && random() < 0.12);
      const clear = polylineDistance({ x, y }, PATH).dist > 1.3 && !insideChapel(x, y, 2);
      if (keep && clear) {
        trees.push({ x, y, r: 0.75 + random() * 0.8, seed: Math.floor(random() * 1e6) });
      }
    }
  }
  return trees;
}

function placeRubble(random: () => number): Circle[] {
  return Array.from({ length: 46 }, () => {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * 1.2;
    return {
      x: 13.2 + Math.cos(angle) * distance * 0.9,
      y: 7.25 + Math.sin(angle) * distance,
      r: 0.06 + random() * 0.13,
      seed: Math.floor(random() * 1e6),
    };
  });
}

/** Trees per square cell so each pixel only tests nearby canopies. */
function bucketTrees(trees: Circle[], reach: number): Map<string, Circle[]> {
  const buckets = new Map<string, Circle[]>();
  for (const tree of trees) {
    for (let cy = Math.floor(tree.y - tree.r - reach); cy <= Math.floor(tree.y + tree.r + reach); cy++) {
      for (let cx = Math.floor(tree.x - tree.r - reach); cx <= Math.floor(tree.x + tree.r + reach); cx++) {
        const key = `${cx},${cy}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push(tree);
        buckets.set(key, bucket);
      }
    }
  }
  return buckets;
}

function ground(x: number, y: number): Color {
  const grass = mix(GRASS_DARK, GRASS_LIGHT, fbm(x * 0.7, y * 0.7, SEED));
  const forest = smoothstep(0.82, 1.05, clearingDistance(x, y) + (fbm(x, y, SEED + 5) - 0.5) * 0.25);
  const base = mix(grass, FOREST_FLOOR, forest);
  const path = polylineDistance({ x, y }, PATH).dist;
  const width = 0.5 + (valueNoise(x * 1.5, y * 1.5, SEED + 9) - 0.5) * 0.25;
  const dirt = mix(DIRT_DARK, DIRT, fbm(x * 2.5, y * 2.5, SEED + 11));
  return mix(base, dirt, 1 - smoothstep(width - 0.12, width, path));
}

function shadowed(color: Color, x: number, y: number, nearby: Circle[]): Color {
  let shade = 1;
  for (const tree of nearby) {
    const d = Math.hypot(x - tree.x - 0.3, y - tree.y - 0.35) / tree.r;
    shade = Math.min(shade, lerp(0.62, 1, smoothstep(0.75, 1.05, d)));
  }
  return scale(color, shade);
}

/** Flagstones half a square wide; some are missing and let the grass through. */
function chapelFloor(color: Color, x: number, y: number): Color {
  let result = color;
  if (insideChapel(x, y, 0)) {
    const sx = Math.floor(x * 2);
    const sy = Math.floor(y * 2);
    const fx = x * 2 - sx;
    const fy = y * 2 - sy;
    const missing = hash2(sx, sy, SEED + 21) < 0.07;
    const stone = scale(
      FLAG_STONE,
      0.86 + hash2(sx, sy, SEED + 22) * 0.2 + (fbm(x * 6, y * 6, SEED + 23) - 0.5) * 0.12,
    );
    const mossy = mix(stone, MOSS, smoothstep(0.55, 0.75, fbm(x * 1.2, y * 1.2, SEED + 24)) * 0.7);
    const joint = fx < 0.05 || fx > 0.95 || fy < 0.05 || fy > 0.95;
    result = missing ? mix(color, DIRT_DARK, 0.4) : joint ? MORTAR : mossy;
  }
  return result;
}

/** Two rows of pews either side of the aisle; a few are broken off. */
function furniture(color: Color, x: number, y: number): Color {
  let result = color;
  const row = Math.floor((y - 5.3) / 1);
  const inRow = y - 5.3 - row < 0.42 && row >= 0 && row < 4;
  const left = x > 7.6 && x < 9.4;
  const right = x > 10.6 && x < (row === 2 ? 11.5 : 12.4);
  if (inRow && (left || right)) {
    const edge = y - 5.3 - row < 0.05 || y - 5.3 - row > 0.37;
    result = edge ? WOOD_DARK : scale(WOOD, 0.85 + valueNoise(x * 12, y * 1.5, SEED + 31) * 0.3);
  }
  const inAltar = x > ALTAR_BOX.x0 && x < ALTAR_BOX.x1 && y > ALTAR_BOX.y0 && y < ALTAR_BOX.y1;
  if (inAltar) {
    const rim = Math.min(x - ALTAR_BOX.x0, ALTAR_BOX.x1 - x, y - ALTAR_BOX.y0, ALTAR_BOX.y1 - y) < 0.06;
    result = rim ? WALL_EDGE : scale(ALTAR, 0.92 + fbm(x * 8, y * 8, SEED + 33) * 0.12);
  }
  return result;
}

/** Stone blocks along the walls, a plank door on the south wall, a window gap on the west wall. */
function walls(color: Color, x: number, y: number): Color {
  let result = color;
  const { dist, along } = polylineDistance({ x, y }, WALL_POINTS);
  if (dist < WALL_HALF) {
    const block = Math.floor(along / 0.33 + (dist < 0.02 ? 0 : 0.5));
    const joint = along / 0.33 - Math.floor(along / 0.33) < 0.08;
    const stone = scale(WALL_STONE, 0.85 + hash2(block, 0, SEED + 41) * 0.25);
    result = dist > WALL_HALF - 0.05 || joint ? WALL_EDGE : stone;
  }
  const inDoor = x > DOOR.x0 && x < DOOR.x1 && Math.abs(y - DOOR.y) < WALL_HALF - 0.04;
  if (inDoor) {
    const plank = (x - DOOR.x0) * 6 - Math.floor((x - DOOR.x0) * 6) < 0.1;
    result = plank ? WOOD_DARK : WOOD;
  }
  const inWindow = Math.abs(x - WINDOW.x) < WALL_HALF - 0.05 && y > WINDOW.y0 && y < WINDOW.y1;
  if (inWindow) {
    result = [150, 170, 180];
  }
  return result;
}

function rubble(color: Color, x: number, y: number, stones: Circle[]): Color {
  let result = color;
  for (const stone of stones) {
    const d = Math.hypot(x - stone.x, y - stone.y) / stone.r;
    if (d < 1) {
      result = d > 0.8 ? WALL_EDGE : scale(WALL_STONE, 0.8 + hash2(stone.seed, 0, SEED) * 0.35 - d * 0.15);
    }
  }
  return result;
}

function campfire(color: Color, x: number, y: number): Color {
  const d = Math.hypot(x - CAMPFIRE.x, y - CAMPFIRE.y);
  const angle = Math.atan2(y - CAMPFIRE.y, x - CAMPFIRE.x);
  const ringStone = Math.abs(d - 0.42) < 0.08 && Math.cos(angle * 9) > -0.4;
  const embers = mix(EMBER, ASH, smoothstep(0.05, 0.34, d + (valueNoise(x * 9, y * 9, SEED + 51) - 0.5) * 0.15));
  const glow = mix(color, [180, 120, 60], (1 - smoothstep(0.4, 1.6, d)) * 0.35);
  return d < 0.34 ? embers : ringStone ? WALL_STONE : glow;
}

function canopy(color: Color, x: number, y: number, nearby: Circle[]): Color {
  let result = color;
  for (const tree of nearby) {
    const dx = x - tree.x;
    const dy = y - tree.y;
    const edge = 0.82 + valueNoise(x * 2.4, y * 2.4, tree.seed) * 0.22;
    const d = Math.hypot(dx, dy) / tree.r;
    if (d < edge) {
      const light = clamp01(0.55 - (dx + dy) / (tree.r * 2.4));
      const clumps = 0.78 + valueNoise(x * 3.2, y * 3.2, tree.seed + 1) * 0.3;
      result = scale(mix(TREE_DARK, TREE_LIGHT, light * (1 - d * 0.5)), clumps);
    }
  }
  return result;
}

function drawImage(): Uint8Array {
  const random = mulberry32(SEED);
  const trees = placeTrees(random);
  const stones = placeRubble(random);
  const buckets = bucketTrees(trees, 0.5);
  const width = SQUARES_X * PX;
  const height = SQUARES_Y * PX;
  const rgb = new Uint8Array(width * height * 3);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = (px + 0.5) / PX;
      const y = (py + 0.5) / PX;
      const nearby = buckets.get(`${Math.floor(x)},${Math.floor(y)}`) ?? [];
      let color = shadowed(ground(x, y), x, y, nearby);
      color = walls(furniture(chapelFloor(color, x, y), x, y), x, y);
      color = rubble(color, x, y, stones);
      color = canopy(campfire(color, x, y), x, y, nearby);
      const offset = (py * width + px) * 3;
      rgb[offset] = Math.round(Math.min(255, color[0]));
      rgb[offset + 1] = Math.round(Math.min(255, color[1]));
      rgb[offset + 2] = Math.round(Math.min(255, color[2]));
    }
  }
  return encodePng(width, height, rgb);
}

/** Forest floor rises a few feet around the clearing so the sample shows terrain relief. */
function terrainHeights(map: BattleMap): string {
  const field = HeightField.empty(map.grid, map.terrain.samplesPerSquare);
  for (let row = 0; row < field.rows; row++) {
    for (let col = 0; col < field.cols; col++) {
      const x = (col * field.spacingFt) / FEET;
      const y = (row * field.spacingFt) / FEET;
      field.data[field.index(col, row)] = 4 * smoothstep(0.92, 1.3, clearingDistance(x, y));
    }
  }
  return field.encode();
}

const ft = (p: Vec2): Vec2 => ({ x: p.x * FEET, y: p.y * FEET });

function buildMap(): BattleMap {
  const base = createMap({
    name: 'Sample: ruined chapel',
    image: {
      asset: { area: 'content', path: `maps/${MAP_ID}/assets/${IMAGE_NAME}` },
      widthPx: SQUARES_X * PX,
      heightPx: SQUARES_Y * PX,
    },
    squaresX: SQUARES_X,
    squaresY: SQUARES_Y,
    pxPerSquare: PX,
  });
  const nave = [
    { x: CHAPEL.x0, y: CHAPEL.y0 },
    { x: CHAPEL.x1, y: CHAPEL.y0 },
    { x: CHAPEL.x1, y: CHAPEL.y1 },
    { x: CHAPEL.x0, y: CHAPEL.y1 },
  ].map(ft);
  const map: BattleMap = {
    ...base,
    id: MAP_ID,
    version: MAP_SCHEMA_VERSION,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    tags: ['sample', 'forest', 'ruin'],
    notes:
      'Generated by tools/build-sample.ts. Goblins camp by the fire; the chapel is unlit except for the altar torch.',
    terrain: { ...base.terrain, heights: '', baseColor: '#4f5d32' },
    ambientLight: 'dim',
    walls: [
      {
        id: 'sample-wall',
        points: WALL_POINTS.map(ft),
        closed: false,
        heightFt: 12,
        thicknessFt: 2,
        baseFt: null,
        material: 'stone',
        blocksSight: true,
        blocksMovement: true,
        blocksLight: true,
      },
    ],
    openings: [
      {
        id: 'sample-door',
        wallId: 'sample-wall',
        segment: 3,
        t: 0.5,
        widthFt: 5,
        heightFt: 7,
        sillFt: 0,
        kind: 'door',
        state: 'closed',
        secret: false,
      },
      {
        id: 'sample-window',
        wallId: 'sample-wall',
        segment: 2,
        // Segment 2 runs down the west wall from the nave's north-west corner.
        t: ((WINDOW.y0 + WINDOW.y1) / 2 - CHAPEL.y0) / (CHAPEL.y1 - CHAPEL.y0),
        widthFt: 3,
        heightFt: 4,
        sillFt: 3,
        kind: 'window',
        state: 'closed',
        secret: false,
      },
    ],
    rooms: [
      {
        id: 'sample-nave',
        name: 'Chapel nave',
        polygon: nave,
        floorFt: null,
        ceilingFt: 12,
        roof: true,
        roofMaterial: 'wood',
      },
    ],
    regions: [
      {
        id: 'sample-dark-nave',
        name: 'Unlit nave',
        polygon: nave,
        kind: 'light',
        light: 'darkness',
        color: '#202040',
        hiddenFromPlayers: true,
        notes: 'Only the altar torch lights the nave.',
      },
      {
        id: 'sample-rubble',
        name: 'Rubble',
        polygon: [
          { x: 12.7, y: 6.1 },
          { x: 14.4, y: 6.2 },
          { x: 14.4, y: 8.4 },
          { x: 12.7, y: 8.4 },
        ].map(ft),
        kind: 'difficult',
        light: null,
        color: '#8a7f6a',
        hiddenFromPlayers: false,
        notes: 'Collapsed wall: difficult terrain.',
      },
    ],
    lights: [
      {
        id: 'sample-altar-torch',
        name: 'Altar torch',
        position: { ...ft({ x: 10, y: 4.3 }), elevationFt: 4 },
        brightFt: 20,
        dimFt: 20,
        color: '#ffb35c',
        enabled: true,
        attachedTo: null,
      },
      {
        id: 'sample-campfire',
        name: 'Campfire',
        position: { ...ft(CAMPFIRE), elevationFt: 1 },
        brightFt: 10,
        dimFt: 20,
        color: '#ff8a3d',
        enabled: true,
        attachedTo: null,
      },
    ],
  };
  return mapSchema.parse({ ...map, terrain: { ...map.terrain, heights: terrainHeights(map) } });
}

const dir = join(CONTENT_ROOT, 'maps', MAP_ID);
mkdirSync(join(dir, 'assets'), { recursive: true });
const png = drawImage();
writeFileSync(join(dir, 'assets', IMAGE_NAME), png);
writeFileSync(join(dir, 'map.json'), `${JSON.stringify(buildMap(), null, 2)}\n`);
console.log(`Wrote ${dir} (image ${(png.length / 1024 / 1024).toFixed(1)} MiB)`);
