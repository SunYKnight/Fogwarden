import { describe, expect, it } from 'vitest';
import { closestPointOnSegment, polygonArea, signedPolygonArea } from './polygon';

const clockwise = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 3 },
  { x: 0, y: 3 },
];

describe('polygon helpers', () => {
  it('computes area and winding as seen from above with north up', () => {
    expect(signedPolygonArea(clockwise)).toBe(12);
    expect(polygonArea([...clockwise].reverse())).toBe(12);
  });

  it('projects a point onto a segment and clamps to its ends', () => {
    expect(closestPointOnSegment({ x: 2, y: 5 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual({
      t: 0.5,
      point: { x: 2, y: 0 },
      distance: 5,
    });
    expect(closestPointOnSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 4, y: 0 }).distance).toBe(5);
    expect(closestPointOnSegment({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 2 }).t).toBe(0);
  });
});
