import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createMap } from '@/core/model';
import { imagePxToWorld, worldToImagePx, worldToUvMatrix } from './projection';

const grid = {
  ...createMap({ name: 'm', image: null, squaresX: 10, squaresY: 8, pxPerSquare: 100 }).grid,
  offsetPx: { x: 40, y: -25 },
  rotationDeg: 30,
};
const image = { widthPx: 1200, heightPx: 900 };

describe('battlemap projection', () => {
  it('maps the map origin to the calibrated pixel offset', () => {
    expect(worldToImagePx(grid, { x: 0, y: 0 })).toEqual({ x: 40, y: -25 });
  });

  it('scales one grid square to pxPerSquare pixels', () => {
    const unrotated = { ...grid, rotationDeg: 0 };
    expect(worldToImagePx(unrotated, { x: 5, y: 10 })).toEqual({ x: 140, y: 175 });
  });

  it('inverts exactly with rotation and offset', () => {
    const point = { x: 17.5, y: 32 };
    const back = imagePxToWorld(grid, worldToImagePx(grid, point));
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it('shader matrix agrees with the pixel mapping and flips v', () => {
    const point = { x: 12, y: 21 };
    const px = worldToImagePx(grid, point);
    const uv = new Vector3(point.x, point.y, 1).applyMatrix3(worldToUvMatrix(grid, image));
    expect(uv.x).toBeCloseTo(px.x / image.widthPx, 9);
    expect(uv.y).toBeCloseTo(1 - px.y / image.heightPx, 9);
  });
});
