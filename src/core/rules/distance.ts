import type { Vec2 } from '../model/common';
import type { Grid } from '../model/map';
import type { Settings } from '../model/settings';

/**
 * Movement distance between the squares containing `a` and `b`.
 * '5-5-5': every diagonal costs one square (PHB default).
 * '5-10-5': every second diagonal costs two squares (DMG variant).
 */
export function gridDistanceFt(a: Vec2, b: Vec2, grid: Grid, rule: Settings['diagonalRule']): number {
  const size = grid.feetPerSquare;
  const dx = Math.abs(Math.floor(b.x / size) - Math.floor(a.x / size));
  const dy = Math.abs(Math.floor(b.y / size) - Math.floor(a.y / size));
  const extra = rule === '5-10-5' ? Math.floor(Math.min(dx, dy) / 2) : 0;
  return (Math.max(dx, dy) + extra) * size;
}
