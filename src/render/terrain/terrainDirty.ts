import { unionRect, type SampleRect } from '@/core/terrain/brushes';
import type { HeightField } from '@/core/terrain/heightfield';

/** Samples changed since the terrain mesh was last written, and how many terrain versions they cover. */
export interface TerrainDirty {
  rect: SampleRect;
  changes: number;
}

const pending = new WeakMap<HeightField, TerrainDirty>();

/**
 * Records that only `rect` changed in the next terrain version bump. Call once right before each
 * `terrainChanged()` of a sculpt stroke; the mesh then updates just that region. Version bumps without
 * a mark (undo, loading) make the counts disagree and fall back to a full update.
 */
export function markTerrainDirty(field: HeightField, rect: SampleRect): void {
  const current = pending.get(field);
  pending.set(field, { rect: unionRect(current?.rect ?? null, rect)!, changes: (current?.changes ?? 0) + 1 });
}

export function takeTerrainDirty(field: HeightField): TerrainDirty | undefined {
  const dirty = pending.get(field);
  pending.delete(field);
  return dirty;
}
