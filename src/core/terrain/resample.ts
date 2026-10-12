import type { Grid } from '../model/map';
import { HeightField } from './heightfield';

/**
 * Height field for a new grid size or resolution with every sample taken bilinearly from `field` at the
 * same map plane position, so sculpted shapes keep their place and size in feet. Areas the old field did
 * not cover continue its border heights.
 */
export function resampleHeightField(field: HeightField, grid: Grid, samplesPerSquare: number): HeightField {
  const next = HeightField.empty(grid, samplesPerSquare);
  for (let r = 0; r < next.rows; r++) {
    for (let c = 0; c < next.cols; c++) {
      next.data[next.index(c, r)] = field.sample(c * next.spacingFt, r * next.spacingFt);
    }
  }
  return next;
}
