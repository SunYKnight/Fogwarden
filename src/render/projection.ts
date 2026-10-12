import { Matrix3 } from 'three';
import type { Grid, MapImage, Vec2 } from '@/core/model';

/**
 * Matrix taking homogeneous map plane feet (x east, y south, 1) to texture UV (u, v, 1).
 * Image pixels: px = offsetPx + R(rotation) * (ft / feetPerSquare * pxPerSquare); v is flipped because
 * three.js textures have their origin at the bottom-left.
 */
export function worldToUvMatrix(grid: Grid, image: Pick<MapImage, 'widthPx' | 'heightPx'>): Matrix3 {
  const scale = grid.pxPerSquare / grid.feetPerSquare;
  const rad = (grid.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad) * scale;
  const s = Math.sin(rad) * scale;
  const w = image.widthPx;
  const h = image.heightPx;
  // prettier-ignore
  return new Matrix3().set(
    c / w, -s / w, grid.offsetPx.x / w,
    -s / h, -c / h, 1 - grid.offsetPx.y / h,
    0, 0, 1,
  );
}

/** Image pixel under a map plane point. */
export function worldToImagePx(grid: Grid, point: Vec2): Vec2 {
  const scale = grid.pxPerSquare / grid.feetPerSquare;
  const rad = (grid.rotationDeg * Math.PI) / 180;
  const x = point.x * scale;
  const y = point.y * scale;
  return {
    x: grid.offsetPx.x + Math.cos(rad) * x - Math.sin(rad) * y,
    y: grid.offsetPx.y + Math.sin(rad) * x + Math.cos(rad) * y,
  };
}

/** Map plane point under an image pixel (inverse of `worldToImagePx`). */
export function imagePxToWorld(grid: Grid, px: Vec2): Vec2 {
  const scale = grid.pxPerSquare / grid.feetPerSquare;
  const rad = (grid.rotationDeg * Math.PI) / 180;
  const dx = px.x - grid.offsetPx.x;
  const dy = px.y - grid.offsetPx.y;
  return {
    x: (Math.cos(rad) * dx + Math.sin(rad) * dy) / scale,
    y: (-Math.sin(rad) * dx + Math.cos(rad) * dy) / scale,
  };
}
