import { useEffect, useMemo } from 'react';
import { LinearMipmapLinearFilter, type Texture } from 'three';
import type { BattleMap } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import {
  createProjectionUniforms,
  setFogMode,
  type FogMode,
  type ProjectionUniforms,
} from './materials/projectedMaterial';
import { loadImageTexture } from './loadImageTexture';
import { worldToUvMatrix } from './projection';

/** Keeps one map's shared projection uniforms in sync with its document; loads the battlemap texture. */
export function useProjectionUniforms(map: BattleMap, fogMode: FogMode): ProjectionUniforms {
  const uniforms = useMemo(() => createProjectionUniforms(), []);
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const { grid, image, terrain } = map;

  useEffect(() => {
    let cancelled = false;
    let loaded: Texture | null = null;
    if (image) {
      repository.storage
        .assetUrl(image.asset)
        .then((url) => loadImageTexture(url, image))
        .then((texture) => {
          texture.minFilter = LinearMipmapLinearFilter;
          texture.anisotropy = 8;
          loaded = texture;
          if (cancelled) {
            texture.dispose();
          } else {
            uniforms.uMap.value = texture;
            uniforms.uHasMap.value = 1;
          }
        })
        .catch(reportError);
    } else {
      uniforms.uMap.value = null;
      uniforms.uHasMap.value = 0;
    }
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [image, repository, reportError, uniforms]);

  useEffect(() => {
    if (image) {
      uniforms.uWorldToUv.value.copy(worldToUvMatrix(grid, image));
    }
    uniforms.uGridShow.value = grid.show ? 1 : 0;
    uniforms.uGridSize.value = grid.feetPerSquare;
    uniforms.uGridCount.value.set(grid.squaresX, grid.squaresY);
    uniforms.uGridColor.value.set(grid.color);
    uniforms.uGridOpacity.value = grid.opacity;
    uniforms.uMapSizeFt.value.set(grid.squaresX * grid.feetPerSquare, grid.squaresY * grid.feetPerSquare);
    uniforms.uBaseColor.value.set(terrain.baseColor);
  }, [grid, image, terrain.baseColor, uniforms]);

  useEffect(() => setFogMode(uniforms, fogMode), [fogMode, uniforms]);

  return uniforms;
}
