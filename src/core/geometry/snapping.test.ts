import { describe, expect, it } from 'vitest';
import { snapPoint } from './snapping';

describe('snapPoint', () => {
  it('prefers an existing wall vertex over a closer grid corner', () => {
    const result = snapPoint({ x: 5.3, y: 0.2 }, 5, { radiusFt: 1.5, vertices: [{ x: 6, y: 0.5 }] });
    expect(result).toEqual({ point: { x: 6, y: 0.5 }, kind: 'vertex' });
  });

  it('prefers a grid corner over an edge midpoint when both are in range', () => {
    const result = snapPoint({ x: 6, y: 0.2 }, 5, { radiusFt: 3, vertices: [] });
    expect(result).toEqual({ point: { x: 5, y: 0 }, kind: 'corner' });
  });

  it('snaps to the midpoint of the nearest square edge when no corner is in range', () => {
    expect(snapPoint({ x: 7.3, y: 0.1 }, 5, { radiusFt: 1.25, vertices: [] })).toEqual({
      point: { x: 7.5, y: 0 },
      kind: 'midpoint',
    });
    expect(snapPoint({ x: 10.2, y: 12.4 }, 5, { radiusFt: 1.25, vertices: [] })).toEqual({
      point: { x: 10, y: 12.5 },
      kind: 'midpoint',
    });
  });

  it('ignores vertices outside the radius and leaves far points unchanged', () => {
    const result = snapPoint({ x: 3.7, y: 3.6 }, 5, { radiusFt: 0.5, vertices: [{ x: 20, y: 20 }] });
    expect(result).toEqual({ point: { x: 3.7, y: 3.6 }, kind: 'none' });
  });
});
