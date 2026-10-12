import { describe, expect, it } from 'vitest';
import { calibrateFromSquare, fitSquaresToImage, type GridCalibration } from './calibration';

/** Image pixel of grid corner (i, j) for a known calibration, same formula as the projection. */
function cornerPx(grid: GridCalibration, i: number, j: number) {
  const rad = (grid.rotationDeg * Math.PI) / 180;
  const x = i * grid.pxPerSquare;
  const y = j * grid.pxPerSquare;
  return {
    x: grid.offsetPx.x + Math.cos(rad) * x - Math.sin(rad) * y,
    y: grid.offsetPx.y + Math.sin(rad) * x + Math.cos(rad) * y,
  };
}

function expectCalibration(actual: GridCalibration, expected: GridCalibration) {
  expect(actual.pxPerSquare).toBeCloseTo(expected.pxPerSquare, 6);
  expect(actual.rotationDeg).toBeCloseTo(expected.rotationDeg, 6);
  expect(actual.offsetPx.x).toBeCloseTo(expected.offsetPx.x, 6);
  expect(actual.offsetPx.y).toBeCloseTo(expected.offsetPx.y, 6);
}

describe('calibrateFromSquare', () => {
  const rotated: GridCalibration = { pxPerSquare: 70, rotationDeg: 10, offsetPx: { x: 13, y: -20 } };

  it('recovers size, rotation and offset from two opposite corners of a rotated square', () => {
    const result = calibrateFromSquare(cornerPx(rotated, 3, 4), cornerPx(rotated, 4, 5), null);
    expectCalibration(result, rotated);
  });

  it('gives the same grid for the other diagonal and either click order', () => {
    expectCalibration(calibrateFromSquare(cornerPx(rotated, 4, 4), cornerPx(rotated, 3, 5), null), rotated);
    expectCalibration(calibrateFromSquare(cornerPx(rotated, 4, 5), cornerPx(rotated, 3, 4), null), rotated);
    expectCalibration(calibrateFromSquare(cornerPx(rotated, 3, 5), cornerPx(rotated, 4, 4), null), rotated);
  });

  it('keeps a given rotation and moves the origin to the grid corner nearest the image corner', () => {
    const straight: GridCalibration = { pxPerSquare: 50, rotationDeg: 0, offsetPx: { x: 20, y: 15 } };
    const result = calibrateFromSquare({ x: 520, y: 315 }, { x: 570, y: 365 }, 0);
    expectCalibration(result, straight);
    // Slightly misclicked corners still give the square size from both edges.
    const sloppy = calibrateFromSquare({ x: 521, y: 314 }, { x: 569, y: 366 }, 0);
    expect(sloppy.pxPerSquare).toBeCloseTo(50, 6);
  });

  it('rejects identical corners', () => {
    expect(() => calibrateFromSquare({ x: 5, y: 5 }, { x: 5, y: 5 }, null)).toThrow(/must differ/);
  });
});

describe('fitSquaresToImage', () => {
  it('rounds the image size to whole squares', () => {
    expect(fitSquaresToImage({ widthPx: 3500, heightPx: 2480 }, 70)).toEqual({ squaresX: 50, squaresY: 35 });
  });
});
