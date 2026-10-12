import { describe, expect, it } from 'vitest';
import {
  brushRect,
  falloffWeight,
  flattenBrush,
  noiseBrush,
  raiseBrush,
  rampBrush,
  smoothBrush,
  strokeDabs,
  terraceBrush,
  type Brush,
} from './brushes';
import { HeightField } from './heightfield';

/** 21x21 samples, 1 ft apart. */
function field(fill = 0): HeightField {
  return new HeightField(21, 21, 1, new Float32Array(21 * 21).fill(fill));
}

function brush(x: number, y: number, radiusFt: number, falloff: Brush['falloff'] = 'linear'): Brush {
  return { center: { x, y }, radiusFt, falloff };
}

describe('falloff', () => {
  it('has full weight at the center and none at the radius for every profile', () => {
    for (const falloff of ['smooth', 'linear', 'constant'] as const) {
      expect(falloffWeight(0, 4, falloff)).toBe(1);
      expect(falloffWeight(4, 4, falloff)).toBe(0);
      expect(falloffWeight(5, 4, falloff)).toBe(0);
    }
  });

  it('follows the profile in between', () => {
    expect(falloffWeight(2, 4, 'linear')).toBe(0.5);
    expect(falloffWeight(2, 4, 'smooth')).toBe(0.5);
    expect(falloffWeight(1, 4, 'smooth')).toBeCloseTo(0.84375, 6);
    expect(falloffWeight(3, 4, 'constant')).toBe(1);
  });
});

describe('raise brush', () => {
  it('adds the amount scaled by the falloff and leaves samples outside the radius alone', () => {
    const f = field();
    const rect = raiseBrush(f, brush(10, 10, 4), 2);
    expect(rect).toEqual({ c0: 6, r0: 6, c1: 14, r1: 14 });
    expect(f.at(10, 10)).toBe(2);
    expect(f.at(12, 10)).toBe(1);
    expect(f.at(14, 10)).toBe(0);
    expect(f.at(5, 10)).toBe(0);
  });

  it('lowers with a negative amount', () => {
    const f = field(3);
    raiseBrush(f, brush(10, 10, 4, 'constant'), -1);
    expect(f.at(10, 10)).toBe(2);
    expect(f.at(13, 10)).toBe(2);
  });

  it('clamps to the field at map edges', () => {
    const f = field();
    const rect = raiseBrush(f, brush(0, 20, 3, 'constant'), 1);
    expect(rect).toEqual({ c0: 0, r0: 17, c1: 3, r1: 20 });
    expect(f.data.length).toBe(21 * 21);
    const raised = f.data.reduce((n, h) => n + (h > 0 ? 1 : 0), 0);
    // Quarter disc of radius 3 on the 1-ft lattice: 3 rows of 3 samples.
    expect(raised).toBe(9);
  });

  it('does nothing for a brush completely outside the map', () => {
    const f = field();
    expect(raiseBrush(f, brush(-10, 5, 3), 1)).toBeNull();
    expect(brushRect(f, { x: 30, y: 30 }, 2)).toBeNull();
    expect(f.data.every((h) => h === 0)).toBe(true);
  });
});

describe('smooth brush', () => {
  it('pulls a spike towards its neighbours and keeps flat ground flat', () => {
    const f = field(1);
    f.data[f.index(10, 10)] = 10;
    smoothBrush(f, brush(10, 10, 3, 'constant'), 1);
    expect(f.at(10, 10)).toBe(2);
    expect(f.at(11, 10)).toBe(2);
    expect(f.at(13, 13)).toBe(1);
  });

  it('reads neighbours from before the dab, so the result does not depend on scan order', () => {
    const f = field();
    f.data[f.index(10, 10)] = 9;
    smoothBrush(f, brush(10, 10, 2, 'constant'), 1);
    expect(f.at(9, 10)).toBe(f.at(11, 10));
    expect(f.at(10, 9)).toBe(f.at(10, 11));
  });
});

describe('flatten brush', () => {
  it('blends towards the target by strength times falloff', () => {
    const f = field(10);
    flattenBrush(f, brush(10, 10, 4), 2, 1);
    expect(f.at(10, 10)).toBe(2);
    expect(f.at(12, 10)).toBe(6);
    flattenBrush(f, brush(10, 10, 4), 2, 0.5);
    expect(f.at(12, 10)).toBe(5);
  });
});

describe('terrace brush', () => {
  it('snaps a slope to steps at full strength', () => {
    const f = field();
    for (let c = 0; c < f.cols; c++) {
      for (let r = 0; r < f.rows; r++) f.data[f.index(c, r)] = c * 0.9;
    }
    terraceBrush(f, brush(10, 10, 30, 'constant'), 5, 1);
    expect([f.at(2, 0), f.at(3, 0), f.at(8, 0), f.at(9, 0), f.at(20, 0)]).toEqual([0, 5, 5, 10, 20]);
  });
});

describe('noise brush', () => {
  it('is deterministic per seed and bounded by the amount', () => {
    const a = field();
    const b = field();
    const c = field();
    noiseBrush(a, brush(10, 10, 8, 'constant'), 2, 4, 7);
    noiseBrush(b, brush(10, 10, 8, 'constant'), 2, 4, 7);
    noiseBrush(c, brush(10, 10, 8, 'constant'), 2, 4, 8);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data));
    expect(a.data.every((h) => Math.abs(h) <= 2)).toBe(true);
    expect(a.data.some((h) => Math.abs(h) > 0.1)).toBe(true);
  });
});

describe('ramp brush', () => {
  it('builds a linear slope between the end heights across the brush width only', () => {
    const f = field();
    const rect = rampBrush(f, { x: 2, y: 10 }, { x: 18, y: 10 }, 0, 8, { radiusFt: 2, falloff: 'constant' }, 1);
    expect(rect).toEqual({ c0: 2, r0: 9, c1: 18, r1: 11 });
    expect(f.at(2, 10)).toBe(0);
    expect(f.at(10, 10)).toBe(4);
    expect(f.at(14, 11)).toBe(6);
    expect(f.at(18, 9)).toBe(8);
    // Beyond the ends and outside the width the terrain stays.
    expect(f.at(19, 10)).toBe(0);
    expect(f.at(10, 12)).toBe(0);
  });

  it('blends the sides with the falloff', () => {
    const f = field();
    rampBrush(f, { x: 0, y: 10 }, { x: 20, y: 10 }, 10, 10, { radiusFt: 4, falloff: 'linear' }, 1);
    expect(f.at(10, 10)).toBe(10);
    expect(f.at(10, 12)).toBe(5);
  });

  it('ignores a zero-length ramp', () => {
    expect(rampBrush(field(), { x: 3, y: 3 }, { x: 3, y: 3 }, 0, 5, { radiusFt: 2, falloff: 'smooth' }, 1)).toBeNull();
  });
});

describe('stroke dabs', () => {
  it('places dabs at fixed spacing however the movement is split into events', () => {
    const once = strokeDabs({ x: 0, y: 0 }, { x: 10, y: 0 }, 2.5);
    const split: { x: number; y: number }[] = [];
    let last = { x: 0, y: 0 };
    for (let x = 1; x <= 10; x++) {
      const dabs = strokeDabs(last, { x, y: 0 }, 2.5);
      split.push(...dabs);
      last = dabs[dabs.length - 1] ?? last;
    }
    expect(once.map((p) => p.x)).toEqual([2.5, 5, 7.5, 10]);
    expect(split.map((p) => p.x)).toEqual([2.5, 5, 7.5, 10]);
  });
});
