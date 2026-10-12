import { describe, expect, it } from 'vitest';
import { createMap } from '../model/factories';
import type { AreaShape } from '../model/marker';
import { abilityModifier, formatCr, formatModifier, proficiencyBonusForCr, xpForCr } from './abilities';
import { averageDice, DiceError, parseDice, rollDice } from './dice';
import { gridDistanceFt } from './distance';
import { areaCells, areaOutline } from './templates';

/** Deterministic rng returning the given values in order; die = 1 + floor(v * sides). */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('parseDice', () => {
  it('parses multiple terms, flat bonuses and implicit counts with whitespace', () => {
    expect(parseDice(' 2d6 + 1d4 + 3 ')).toEqual({
      expression: '2d6+1d4+3',
      terms: [
        { count: 2, sides: 6 },
        { count: 1, sides: 4 },
      ],
      flat: 3,
    });
    expect(parseDice('1d20-1')).toMatchObject({ expression: '1d20-1', flat: -1 });
    expect(parseDice('d8')).toMatchObject({ expression: '1d8', terms: [{ count: 1, sides: 8 }], flat: 0 });
    expect(parseDice('5')).toMatchObject({ expression: '5', terms: [], flat: 5 });
    expect(parseDice('2D6+1+2')).toMatchObject({ expression: '2d6+3' });
  });

  it('rejects malformed expressions and names the bad input', () => {
    for (const bad of ['', '2d', 'd', '2d6+', '2x6', '1d20--1', '0d6', '1d0', '1d20-1d4']) {
      expect(() => parseDice(bad), bad).toThrow(DiceError);
    }
    expect(() => parseDice('2d6+abc')).toThrow('"2d6+abc"');
  });
});

describe('rollDice', () => {
  it('sums every die and the flat bonus with a seeded rng', () => {
    const roll = rollDice('2d6+1d4+3', { rng: sequence(0, 0.99, 0.5) });
    expect(roll.terms.map((t) => t.results)).toEqual([[1, 6], [3]]);
    expect(roll.total).toBe(13);
    expect(roll.detail).toBe('2d6 [1, 6] + 1d4 [3] + 3 = 13');
  });

  it('keeps the higher d20 with advantage and the lower with disadvantage', () => {
    const adv = rollDice('1d20+5', { rng: sequence(0.2, 0.8), mode: 'advantage' });
    expect(adv.terms[0]).toMatchObject({ results: [5, 17], kept: [17] });
    expect(adv.total).toBe(22);
    expect(adv.detail).toBe('1d20 [(5), 17] + 5 = 22');
    const dis = rollDice('1d20-1', { rng: sequence(0.2, 0.8), mode: 'disadvantage' });
    expect(dis.terms[0]).toMatchObject({ results: [5, 17], kept: [5] });
    expect(dis.total).toBe(4);
    expect(dis.detail).toBe('1d20 [5, (17)] - 1 = 4');
  });

  it('refuses advantage without a d20 term', () => {
    expect(() => rollDice('2d6', { mode: 'advantage' })).toThrow(DiceError);
  });

  it('never rolls outside 1..sides', () => {
    expect(rollDice('3d6', { rng: () => 0.9999999999 }).terms[0]!.results).toEqual([6, 6, 6]);
    expect(rollDice('3d6', { rng: () => 0 }).terms[0]!.results).toEqual([1, 1, 1]);
  });
});

describe('averageDice', () => {
  it('rounds the expected value down once (5e stat block averages)', () => {
    expect(averageDice('2d6')).toBe(7);
    expect(averageDice('19d12+133')).toBe(256);
    expect(averageDice('1d4-1')).toBe(1);
    expect(averageDice('2d10+8+2d6')).toBe(26);
    expect(averageDice('3')).toBe(3);
  });
});

describe('abilities', () => {
  it('floors modifiers for odd and low scores', () => {
    expect([1, 8, 9, 10, 11, 12, 27, 30].map(abilityModifier)).toEqual([-5, -1, -1, 0, 0, 1, 8, 10]);
    expect([formatModifier(2), formatModifier(0), formatModifier(-1)]).toEqual(['+2', '+0', '-1']);
  });

  it('follows the monster proficiency and XP tables', () => {
    const crs = [0, 0.125, 0.25, 0.5, 1, 4, 5, 8, 9, 13, 17, 21, 25, 29, 30];
    expect(crs.map(proficiencyBonusForCr)).toEqual([2, 2, 2, 2, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 9]);
    expect([0, 0.125, 0.25, 0.5, 1, 5, 17, 21, 30].map(xpForCr)).toEqual([
      10, 25, 50, 100, 200, 1800, 18000, 33000, 155000,
    ]);
    expect(() => xpForCr(0.3)).toThrow(RangeError);
    expect([0.125, 0.25, 0.5, 3].map(formatCr)).toEqual(['1/8', '1/4', '1/2', '3']);
  });
});

const grid = createMap({ name: 'g', image: null, squaresX: 20, squaresY: 20, pxPerSquare: 50 }).grid;

describe('gridDistanceFt', () => {
  const a = { x: 2.5, y: 2.5 };
  it('counts every diagonal as one square with 5-5-5', () => {
    expect(gridDistanceFt(a, { x: 22.5, y: 2.5 }, grid, '5-5-5')).toBe(20);
    expect(gridDistanceFt(a, { x: 22.5, y: 17.5 }, grid, '5-5-5')).toBe(20);
  });

  it('charges every second diagonal double with 5-10-5', () => {
    expect(gridDistanceFt(a, { x: 7.5, y: 7.5 }, grid, '5-10-5')).toBe(5);
    expect(gridDistanceFt(a, { x: 12.5, y: 12.5 }, grid, '5-10-5')).toBe(15);
    expect(gridDistanceFt(a, { x: 22.5, y: 17.5 }, grid, '5-10-5')).toBe(25);
  });

  it('measures square to square regardless of the position inside a square', () => {
    expect(gridDistanceFt({ x: 0.1, y: 0.1 }, { x: 9.9, y: 4.9 }, grid, '5-5-5')).toBe(5);
  });
});

type Cell = { col: number; row: number };
const key = (c: Cell) => `${c.col},${c.row}`;
const keys = (cells: Cell[]) => cells.map(key).sort();

function cells(shape: AreaShape, sizeFt: number, origin: { x: number; y: number }, directionDeg: number) {
  const area = { shape, sizeFt, widthFt: 5, heightFt: 20, origin: { ...origin, elevationFt: 0 }, directionDeg };
  return areaCells(area, grid);
}

/** Mirror across the 45° diagonal through (50, 50): the 0°/90° images of a 45° area are the same set. */
function mirroredDiagonal(list: Cell[]): string[] {
  return keys(list.map((c) => ({ col: c.row, row: c.col })));
}

describe('areaCells', () => {
  it('sphere of 20 ft covers the 52 squares of the 5e template, independent of direction', () => {
    const sphere = cells('sphere', 20, { x: 50, y: 50 }, 0);
    expect(sphere).toHaveLength(52);
    expect(keys(cells('sphere', 20, { x: 50, y: 50 }, 45))).toEqual(keys(sphere));
    expect(keys(cells('sphere', 20, { x: 50, y: 50 }, 90))).toEqual(keys(sphere));
    expect(sphere.map(key)).toContain('6,9');
    expect(sphere.map(key)).not.toContain('6,6');
    expect(sphere.map(key)).toContain('7,7');
  });

  it('cylinder grows from the nearest grid intersection', () => {
    expect(keys(cells('cylinder', 20, { x: 51, y: 49 }, 0))).toEqual(keys(cells('sphere', 20, { x: 50, y: 50 }, 0)));
  });

  it('cone is as wide as it is long at its end', () => {
    expect(keys(cells('cone', 15, { x: 50, y: 50 }, 0))).toEqual(['11,10', '11,9', '12,10', '12,9']);
    expect(keys(cells('cone', 15, { x: 50, y: 50 }, 90))).toEqual(['10,11', '10,12', '9,11', '9,12']);
    const diagonal = cells('cone', 15, { x: 50, y: 50 }, 45);
    expect(keys(diagonal)).toEqual(mirroredDiagonal(diagonal));
    expect(keys(diagonal)).toEqual(['10,10', '10,11', '11,10', '11,11', '11,12', '12,11']);
  });

  it('line has its length along the direction and its width across', () => {
    expect(keys(cells('line', 30, { x: 50, y: 52.5 }, 0))).toEqual([
      '10,10',
      '11,10',
      '12,10',
      '13,10',
      '14,10',
      '15,10',
    ]);
    expect(keys(cells('line', 30, { x: 52.5, y: 50 }, 90))).toEqual([
      '10,10',
      '10,11',
      '10,12',
      '10,13',
      '10,14',
      '10,15',
    ]);
    const diagonal = cells('line', 30, { x: 50, y: 50 }, 45);
    expect(keys(diagonal)).toEqual(mirroredDiagonal(diagonal));
    expect(keys(diagonal)).toEqual(['10,10', '11,11', '12,12', '13,13']);
  });

  it('cube extends from the centre of its near face', () => {
    const square = ['10,10', '10,11', '10,12', '11,10', '11,11', '11,12', '12,10', '12,11', '12,12'];
    expect(keys(cells('cube', 15, { x: 50, y: 57.5 }, 0))).toEqual(square);
    expect(keys(cells('cube', 15, { x: 57.5, y: 50 }, 90))).toEqual(square);
    const diagonal = cells('cube', 15, { x: 50, y: 50 }, 45);
    expect(keys(diagonal)).toEqual(mirroredDiagonal(diagonal));
    // The rotated face halves the origin's neighbours, so they count too.
    expect(keys(diagonal)).toEqual(
      ['10,10', '10,11', '10,12', '10,9', '11,10', '11,11', '11,12', '11,9', '12,10', '12,11', '9,10', '9,11'].sort(),
    );
  });

  it('clips the area to the map', () => {
    const corner = cells('sphere', 20, { x: 0, y: 0 }, 0);
    expect(corner).toHaveLength(13);
    expect(corner.every((c) => c.col >= 0 && c.row >= 0)).toBe(true);
  });
});

describe('areaOutline', () => {
  it('rotates the cone tip-first in the direction (90° = south)', () => {
    const area = { shape: 'cone' as const, sizeFt: 10, widthFt: 5, heightFt: 5, directionDeg: 90 };
    const outline = areaOutline({ ...area, origin: { x: 0, y: 0, elevationFt: 0 } }, grid);
    expect(outline.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100])).toEqual([
      [0, 0],
      [5, 10],
      [-5, 10],
    ]);
  });
});
