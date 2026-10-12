import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/common';
import type { Opening, Wall } from '../model/map';
import { closedWallAt, nearestWallSegment, splitWallAtVertex } from './wallEdit';

function wall(id: string, points: Vec2[], closed: boolean): Wall {
  return {
    id,
    points,
    closed,
    heightFt: 10,
    thicknessFt: 1,
    baseFt: null,
    material: 'stone',
    blocksSight: true,
    blocksMovement: true,
    blocksLight: true,
  };
}

function square(id: string, x0: number, y0: number, size: number): Wall {
  return wall(
    id,
    [
      { x: x0, y: y0 },
      { x: x0 + size, y: y0 },
      { x: x0 + size, y: y0 + size },
      { x: x0, y: y0 + size },
    ],
    true,
  );
}

function opening(wallId: string, segment: number): Opening {
  return {
    id: `o${segment}`,
    wallId,
    segment,
    t: 0.5,
    widthFt: 3,
    heightFt: 7,
    sillFt: 0,
    kind: 'door',
    state: 'closed',
    secret: false,
  };
}

describe('nearestWallSegment', () => {
  const room = square('room', 0, 0, 20);
  const line = wall(
    'line',
    [
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 40, y: 10 },
    ],
    false,
  );

  it('returns segment and t where an opening clicked on a wall belongs', () => {
    expect(nearestWallSegment({ x: 36, y: 10.3 }, [room, line])).toEqual({
      wallId: 'line',
      segment: 1,
      t: expect.closeTo(0.6),
      point: { x: 36, y: 10 },
      distanceFt: expect.closeTo(0.3),
    });
  });

  it('finds the closing segment of a closed wall last in segment order', () => {
    const hit = nearestWallSegment({ x: -0.2, y: 5 }, [room]);
    expect(hit?.segment).toBe(3);
    expect(hit?.t).toBeCloseTo(0.75);
  });

  it('returns null when no wall is within the distance', () => {
    expect(nearestWallSegment({ x: 10, y: 10 }, [room], 2)).toBeNull();
  });
});

describe('closedWallAt', () => {
  const building = square('building', 0, 0, 40);
  const inner = square('inner', 10, 10, 10);
  const open = wall(
    'open',
    [
      { x: 50, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 10 },
    ],
    false,
  );

  it('picks the smallest closed wall around the point', () => {
    expect(closedWallAt({ x: 15, y: 15 }, [building, inner, open])?.id).toBe('inner');
    expect(closedWallAt({ x: 30, y: 30 }, [building, inner, open])?.id).toBe('building');
  });

  it('accepts a click on the wall body just outside its centerline', () => {
    expect(closedWallAt({ x: 40.4, y: 20 }, [building])?.id).toBe('building');
    expect(closedWallAt({ x: 41, y: 20 }, [building])).toBeNull();
  });

  it('ignores open walls', () => {
    expect(closedWallAt({ x: 55, y: 5 }, [open])).toBeNull();
  });
});

describe('splitWallAtVertex', () => {
  it('splits an open wall into two and moves later openings to the new wall', () => {
    const line = wall(
      'line',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ],
      false,
    );
    const split = splitWallAtVertex(line, [opening('line', 0), opening('line', 2)], 1, 'new');
    expect(split.walls.map((w) => [w.id, w.points.length])).toEqual([
      ['line', 2],
      ['new', 3],
    ]);
    expect(split.openings.map((o) => [o.wallId, o.segment])).toEqual([
      ['line', 0],
      ['new', 1],
    ]);
  });

  it('opens a closed wall at the vertex and renumbers segments from there', () => {
    const room = square('room', 0, 0, 10);
    const split = splitWallAtVertex(room, [opening('room', 3), opening('room', 1)], 2, 'unused');
    expect(split.walls).toHaveLength(1);
    expect(split.walls[0]!.closed).toBe(false);
    expect(split.walls[0]!.points).toEqual([
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(split.openings.map((o) => o.segment)).toEqual([1, 3]);
  });

  it('refuses to split an open wall at an end', () => {
    const line = wall(
      'line',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
    );
    expect(() => splitWallAtVertex(line, [], 0, 'new')).toThrow();
  });
});
