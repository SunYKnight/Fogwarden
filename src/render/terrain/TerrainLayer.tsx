import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { DoubleSide, type BufferGeometry } from 'three';
import { HeightField } from '@/core/terrain/heightfield';
import { createProjectedMaterial } from '../materials/projectedMaterial';
import { useMapRender, type HitTag } from '../mapRenderContext';
import { takeTerrainDirty } from './terrainDirty';
import { createTerrainGeometry, updateTerrainGeometry, updateTerrainRegion } from './terrainGeometry';

const TERRAIN_HIT: HitTag = { kind: 'terrain', id: 'terrain' };

export function TerrainLayer() {
  const { map, terrain, terrainVersion, uniforms } = useMapRender();
  const { cliffMaterial, cliffSlopeDeg } = map.terrain;
  const { cols, rows, spacingFt } = terrain;

  const material = useMemo(() => {
    const created = createProjectedMaterial(uniforms, { side: cliffMaterial, sideFromSlopeDeg: cliffSlopeDeg });
    created.side = DoubleSide;
    return created;
  }, [uniforms, cliffMaterial, cliffSlopeDeg]);

  // Only a size change rebuilds buffers; sculpting edits them in place.
  const geometry = useMemo(
    () => createTerrainGeometry(new HeightField(cols, rows, spacingFt)),
    [cols, rows, spacingFt],
  );

  const written = useRef<{ geometry: BufferGeometry; terrain: HeightField; version: number } | null>(null);
  useLayoutEffect(() => {
    const dirty = takeTerrainDirty(terrain);
    const last = written.current;
    const onlyMarked =
      dirty &&
      last?.geometry === geometry &&
      last.terrain === terrain &&
      terrainVersion - last.version === dirty.changes;
    if (onlyMarked) {
      updateTerrainRegion(geometry, terrain, dirty.rect);
    } else {
      updateTerrainGeometry(geometry, terrain);
    }
    written.current = { geometry, terrain, version: terrainVersion };
  }, [geometry, terrain, terrainVersion]);

  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () => () => {
      geometry.disposeBoundsTree();
      geometry.dispose();
    },
    [geometry],
  );

  return <mesh geometry={geometry} material={material} userData={{ hit: TERRAIN_HIT }} receiveShadow />;
}
