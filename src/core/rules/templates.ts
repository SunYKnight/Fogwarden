import type { MapPoint, Vec2 } from '../model/common';
import type { Grid } from '../model/map';
import type { AreaDimensions } from '../model/marker';

export type PlacedArea = AreaDimensions & { origin: MapPoint; directionDeg: number };

const CIRCLE_SEGMENTS = 64;
const SAMPLES_PER_SQUARE = 10;
// Samples on the area edge count as covered: squares covered exactly half
// (edge through sample points) must count under the "at least half" rule.
const EDGE_EPSILON = 1e-9;

/** Every outline is convex, so a point is inside when it is on the same side of all edges. */
function insideConvex(p: Vec2, polygon: Vec2[]): boolean {
  const sides = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  });
  return sides.every((s) => s >= -EDGE_EPSILON) || sides.every((s) => s <= EDGE_EPSILON);
}

/**
 * Sphere and cylinder grow from the grid intersection nearest to the origin (DMG grid rule);
 * cone, line and cube start exactly at the origin.
 */
function areaOrigin(area: PlacedArea, grid: Grid): Vec2 {
  const size = grid.feetPerSquare;
  const round = area.shape === 'sphere' || area.shape === 'cylinder';
  return round
    ? { x: Math.round(area.origin.x / size) * size, y: Math.round(area.origin.y / size) * size }
    : { x: area.origin.x, y: area.origin.y };
}

/**
 * Footprint on the map plane. directionDeg 0 points east, 90 south.
 * Cone: flat-ended triangle whose width equals its distance from the origin (PHB).
 * Line: `sizeFt` long, `widthFt` wide, centred on the direction. Cube: side `sizeFt`, the face nearest
 * to the origin is centred on it. Sphere/cylinder: circle of radius `sizeFt` (polygon approximation).
 */
export function areaOutline(area: PlacedArea, grid: Grid): Vec2[] {
  const o = areaOrigin(area, grid);
  const rad = (area.directionDeg * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };
  const at = (along: number, side: number): Vec2 => ({
    x: o.x + dir.x * along - dir.y * side,
    y: o.y + dir.y * along + dir.x * side,
  });
  const length = area.sizeFt;
  let outline: Vec2[];
  switch (area.shape) {
    case 'cone':
      outline = [at(0, 0), at(length, -length / 2), at(length, length / 2)];
      break;
    case 'line':
    case 'cube': {
      const half = area.shape === 'line' ? area.widthFt / 2 : length / 2;
      outline = [at(0, -half), at(length, -half), at(length, half), at(0, half)];
      break;
    }
    case 'sphere':
    case 'cylinder':
      outline = Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
        const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        return { x: o.x + Math.cos(a) * length, y: o.y + Math.sin(a) * length };
      });
      break;
  }
  return outline;
}

/** Squares on the map affected by the area: a square counts when at least half of it is covered. */
export function areaCells(area: PlacedArea, grid: Grid): { col: number; row: number }[] {
  const size = grid.feetPerSquare;
  const outline = areaOutline(area, grid);
  const center = areaOrigin(area, grid);
  const round = area.shape === 'sphere' || area.shape === 'cylinder';
  const inside = (p: Vec2): boolean =>
    round ? Math.hypot(p.x - center.x, p.y - center.y) <= area.sizeFt + EDGE_EPSILON : insideConvex(p, outline);
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const col0 = Math.max(0, Math.floor(Math.min(...xs) / size));
  const col1 = Math.min(grid.squaresX - 1, Math.floor(Math.max(...xs) / size));
  const row0 = Math.max(0, Math.floor(Math.min(...ys) / size));
  const row1 = Math.min(grid.squaresY - 1, Math.floor(Math.max(...ys) / size));
  const step = size / SAMPLES_PER_SQUARE;
  const cells: { col: number; row: number }[] = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      let covered = 0;
      for (let sy = 0; sy < SAMPLES_PER_SQUARE; sy++) {
        for (let sx = 0; sx < SAMPLES_PER_SQUARE; sx++) {
          covered += inside({ x: col * size + (sx + 0.5) * step, y: row * size + (sy + 0.5) * step }) ? 1 : 0;
        }
      }
      if (covered * 2 >= SAMPLES_PER_SQUARE * SAMPLES_PER_SQUARE) {
        cells.push({ col, row });
      }
    }
  }
  return cells;
}
