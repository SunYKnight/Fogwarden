import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/common';
import type { Wall } from '../model/map';
import { polygonArea } from './polygon';
import { wallCorners, wallOutline, wallSection, type WallCorner } from './wallOutline';
import { pointInPolygon } from './walls';

function wall(id: string, points: Vec2[], closed = false): Wall {
  return {
    id,
    points,
    closed,
    heightFt: 10,
    thicknessFt: 2,
    baseFt: 0,
    material: 'stone',
    blocksSight: true,
    blocksMovement: true,
    blocksLight: true,
  };
}

function faces(corner: WallCorner): number[][] {
  return [corner.left, corner.right].sort((a, b) => a.x - b.x || a.y - b.y).map((p) => [p.x, p.y]);
}

function closeTo(values: number[][]): unknown[][] {
  return values.map((pair) => pair.map((v) => expect.closeTo(v)));
}

describe('wallCorners', () => {
  it('miters the corner of an L-shaped polyline to the outer and inner face intersection', () => {
    const corners = wallCorners(
      wall('l', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    );
    expect(corners[1]!.left.x).toBeCloseTo(11);
    expect(corners[1]!.left.y).toBeCloseTo(-1);
    expect(corners[1]!.right.x).toBeCloseTo(9);
    expect(corners[1]!.right.y).toBeCloseTo(1);
    expect(corners[0]).toEqual({ left: { x: 0, y: -1 }, right: { x: 0, y: 1 } });
  });

  it('joins two walls that meet end to end like one L, whichever way the second one runs', () => {
    const a = wall('a', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const forward = wall('b', [
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const backward = wall('b', [
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ]);
    const end = wallCorners(a, [a, forward])[1]!;
    const start = wallCorners(forward, [a, forward])[0]!;
    const reversedEnd = wallCorners(backward, [a, backward])[1]!;
    expect(end.left.x).toBeCloseTo(11);
    expect(end.left.y).toBeCloseTo(-1);
    expect(faces(start)).toEqual(closeTo(faces(end)));
    expect(faces(reversedEnd)).toEqual(closeTo(faces(end)));
  });

  it('keeps square ends where three walls meet in a T', () => {
    const left = wall('left', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    const right = wall('right', [
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]);
    const stem = wall('stem', [
      { x: 5, y: 0 },
      { x: 5, y: 10 },
    ]);
    const all = [left, right, stem];
    expect(wallCorners(left, all)[1]).toEqual({ left: { x: 5, y: -1 }, right: { x: 5, y: 1 } });
    expect(wallCorners(stem, all)[0]).toEqual({ left: { x: 6, y: 0 }, right: { x: 4, y: 0 } });
  });

  it('ends a T stem that meets the middle of a wall inside that wall', () => {
    const bar = wall('bar', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const stem = wall('stem', [
      { x: 5, y: 0 },
      { x: 5, y: 10 },
    ]);
    const [ring] = wallOutline(bar, [bar, stem]);
    const start = wallCorners(stem, [bar, stem])[0]!;
    expect(pointInPolygon(start.left, ring!)).toBe(true);
    expect(pointInPolygon(start.right, ring!)).toBe(true);
  });

  it('limits the miter spike of a very sharp angle', () => {
    const corners = wallCorners(
      wall('v', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 0.5 },
      ]),
    );
    const spike = Math.hypot(corners[1]!.left.x - 10, corners[1]!.left.y);
    expect(spike).toBeLessThanOrEqual(4 + 1e-9);
  });
});

describe('wallOutline', () => {
  it('returns outer and inner ring for a closed wall', () => {
    const square = wall(
      's',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
    );
    const rings = wallOutline(square);
    expect(rings).toHaveLength(2);
    expect(rings.map(polygonArea).sort((a, b) => a - b)).toEqual([expect.closeTo(64), expect.closeTo(144)]);
  });

  it('returns one ring around an open wall', () => {
    const rings = wallOutline(
      wall('o', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    );
    expect(rings).toEqual([
      [
        { x: 0, y: -1 },
        { x: 10, y: -1 },
        { x: 10, y: 1 },
        { x: 0, y: 1 },
      ],
    ]);
  });
});

describe('wallSection', () => {
  const l = wall('l', [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);
  const corners = wallCorners(l);

  it('is square inside a segment and mitered at its vertices', () => {
    expect(wallSection(l, corners, 0, 0.5)).toEqual({ left: { x: 5, y: -1 }, right: { x: 5, y: 1 } });
    expect(wallSection(l, corners, 0, 1)).toBe(corners[1]);
    expect(wallSection(l, corners, 1, 0)).toBe(corners[1]);
  });
});
