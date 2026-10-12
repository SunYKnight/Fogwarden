import { describe, expect, it } from 'vitest';
import { monitorLayout, type Rect } from './monitorLayout';

const layout = (rects: Rect[], maxWidth: number, maxHeight: number) =>
  monitorLayout(rects, (r) => r, maxWidth, maxHeight);

describe('monitorLayout', () => {
  it('scales the arrangement uniformly into the box, origin at the top left monitor edge', () => {
    const result = layout(
      [
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: -1280, y: 200, width: 1280, height: 1024 },
      ],
      320,
      200,
    );
    expect(result.width).toBeCloseTo(320);
    expect(result.height).toBeCloseTo(122.4);
    const [main, left] = result.placed.map((p) => p.rect);
    expect(main?.x).toBeCloseTo(128);
    expect(main?.y).toBeCloseTo(0);
    expect(main?.width).toBeCloseTo(192);
    expect(main?.height).toBeCloseTo(108);
    expect(left?.x).toBeCloseTo(0);
    expect(left?.y).toBeCloseTo(20);
    expect(left?.height).toBeCloseTo(102.4);
  });

  it('limits by height for stacked monitors and keeps the items', () => {
    const top = { x: 0, y: 0, width: 1000, height: 1000 };
    const bottom = { x: 0, y: 1000, width: 1000, height: 1000 };
    expect(layout([top, bottom], 300, 100)).toEqual({
      width: 50,
      height: 100,
      placed: [
        { item: top, rect: { x: 0, y: 0, width: 50, height: 50 } },
        { item: bottom, rect: { x: 0, y: 50, width: 50, height: 50 } },
      ],
    });
  });

  it('is empty without monitors', () => {
    expect(layout([], 300, 100)).toEqual({ width: 0, height: 0, placed: [] });
  });
});
