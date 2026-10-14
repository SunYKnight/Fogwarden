import { describe, expect, it } from 'vitest';
import type { Opening, Wall } from '../model/map';
import { pointInPolygon, wallSegments } from './walls';

const wall: Wall = {
  id: 'w',
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ],
  closed: false,
  heightFt: 10,
  thicknessFt: 1,
  baseFt: 0,
  material: 'stone',
  blocksSight: true,
  blocksMovement: true,
  blocksLight: true,
};

function door(overrides: Partial<Opening> = {}): Opening {
  return {
    id: 'd',
    wallId: 'w',
    segment: 0,
    t: 0.5,
    widthFt: 5,
    heightFt: 7,
    sillFt: 0,
    kind: 'door',
    state: 'closed',
    secret: false,
    ...overrides,
  };
}

describe('wallSegments', () => {
  it('splits a segment around a door and keeps the solid parts blocking', () => {
    const pieces = wallSegments({ walls: [wall], openings: [door({ state: 'open' })] }, null);
    expect(pieces.map((p) => [p.a.x, p.b.x, p.openingId, p.blocksSight])).toEqual([
      [0, 7.5, null, true],
      [7.5, 12.5, 'd', false],
      [12.5, 20, null, true],
    ]);
  });

  it('uses the encounter door state over the map state', () => {
    const pieces = wallSegments({ walls: [wall], openings: [door({ state: 'open' })] }, null, {
      openingStates: { d: 'locked' },
    });
    expect(pieces[1]!.blocksMovement && pieces[1]!.blocksSight).toBe(true);
  });

  it('lets sight but not movement through a closed window', () => {
    const piece = wallSegments({ walls: [wall], openings: [door({ kind: 'window' })] }, null)[1]!;
    expect([piece.blocksSight, piece.blocksMovement]).toEqual([false, true]);
  });

  it('keeps an open window blocking movement', () => {
    const piece = wallSegments({ walls: [wall], openings: [door({ kind: 'window', state: 'open' })] }, null)[1]!;
    expect(piece.blocksMovement).toBe(true);
  });

  it('treats a closed secret door as wall for players', () => {
    const piece = wallSegments({ walls: [wall], openings: [door({ secret: true, kind: 'window' })] }, null, {
      secretAsWall: true,
    })[1]!;
    expect(piece.blocksSight).toBe(true);
  });

  it('clamps an opening at the segment end into the segment', () => {
    const pieces = wallSegments({ walls: [wall], openings: [door({ t: 1 })] }, null);
    expect(pieces.map((p) => [p.a.x, p.b.x])).toEqual([
      [0, 15],
      [15, 20],
    ]);
  });

  it('adds the closing segment of closed walls and raises openings by their sill', () => {
    const room: Wall = {
      ...wall,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    const pieces = wallSegments({ walls: [room], openings: [door({ segment: 2, sillFt: 3, kind: 'window' })] }, null);
    const window = pieces.find((p) => p.openingId === 'd')!;
    expect(pieces).toHaveLength(5);
    expect([window.bottomFt[0], window.topFt[0]]).toEqual([3, 10]);
  });
});

describe('polygon helpers', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('finds points inside and outside a polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});
