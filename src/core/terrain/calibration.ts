import type { Vec2 } from '../model/common';
import type { Grid, MapImage } from '../model/map';

export type GridCalibration = Pick<Grid, 'pxPerSquare' | 'rotationDeg' | 'offsetPx'>;

function rotate(v: Vec2, deg: number): Vec2 {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/**
 * Grid placement from two opposite corners of one image square (either diagonal, any order).
 * `rotationDeg` null derives the rotation from the diagonal; a grid looks the same every 90°, so the
 * result lies in [-45°, 45°). The offset is the grid corner nearest the image's top-left pixel, so the
 * map starts where the image does.
 */
export function calibrateFromSquare(a: Vec2, b: Vec2, rotationDeg: number | null): GridCalibration {
  const diagonal = { x: b.x - a.x, y: b.y - a.y };
  const diagonalDeg = (Math.atan2(diagonal.y, diagonal.x) * 180) / Math.PI;
  const rotation = rotationDeg ?? (((diagonalDeg % 90) + 90) % 90) - 45;
  const local = rotate(diagonal, -rotation);
  const size = (Math.abs(local.x) + Math.abs(local.y)) / 2;
  if (!(size > 0)) {
    throw new Error('The two grid corners must differ');
  }
  // Square center is robust against which diagonal was clicked.
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const corner = rotate({ x: -size / 2, y: -size / 2 }, rotation);
  const anchor = { x: center.x + corner.x, y: center.y + corner.y };
  const toOrigin = rotate({ x: -anchor.x / size, y: -anchor.y / size }, -rotation);
  const shift = rotate({ x: Math.round(toOrigin.x) * size, y: Math.round(toOrigin.y) * size }, rotation);
  return { pxPerSquare: size, rotationDeg: rotation, offsetPx: { x: anchor.x + shift.x, y: anchor.y + shift.y } };
}

/** Whole squares covering the image at the calibrated square size. */
export function fitSquaresToImage(
  image: Pick<MapImage, 'widthPx' | 'heightPx'>,
  pxPerSquare: number,
): Pick<Grid, 'squaresX' | 'squaresY'> {
  return {
    squaresX: Math.max(1, Math.round(image.widthPx / pxPerSquare)),
    squaresY: Math.max(1, Math.round(image.heightPx / pxPerSquare)),
  };
}

/** The image's size with its long edge at most `maxEdgePx`, aspect kept; null when it already fits. */
export function reducedImageSize(
  image: Pick<MapImage, 'widthPx' | 'heightPx'>,
  maxEdgePx: number,
): Pick<MapImage, 'widthPx' | 'heightPx'> | null {
  const scale = maxEdgePx / Math.max(image.widthPx, image.heightPx);
  return scale < 1
    ? {
        widthPx: Math.max(1, Math.round(image.widthPx * scale)),
        heightPx: Math.max(1, Math.round(image.heightPx * scale)),
      }
    : null;
}

/** The same grid on the image stored `scale` times as large: pixel lengths scale, the turn stays. */
export function scaleCalibration(calibration: GridCalibration, scale: number): GridCalibration {
  const { pxPerSquare, rotationDeg, offsetPx } = calibration;
  return { pxPerSquare: pxPerSquare * scale, rotationDeg, offsetPx: { x: offsetPx.x * scale, y: offsetPx.y * scale } };
}
