import { useEffect, useMemo } from 'react';
import { LinearMipmapLinearFilter, type Texture } from 'three';
import { isVideoAsset } from '@/core/atmosphere/media';
import type { BattleMap } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import {
  createProjectionUniforms,
  FOG_MODE_VALUE,
  type FogMode,
  type ProjectionUniforms,
} from './materials/projectedMaterial';
import { loadImageTexture } from './loadImageTexture';
import { loadVideoTexture } from './loadVideoTexture';
import { worldToUvMatrix } from './projection';

/**
 * Keeps one map's shared projection uniforms in sync with its document; loads the battlemap texture, a
 * looping video texture when the battlemap is an MP4/WebM.
 */
export function useProjectionUniforms(map: BattleMap, fogMode: FogMode): ProjectionUniforms {
  const uniforms = useMemo(() => createProjectionUniforms(), []);
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const { grid, image, terrain } = map;

  useEffect(() => {
    let cancelled = false;
    let loaded: Texture | null = null;
    if (image) {
      const video = isVideoAsset(image.asset);
      repository.storage
        .assetUrl(image.asset)
        .then((url) => (video ? loadVideoTexture(url) : loadImageTexture(url, image)))
        .then((texture) => {
          // Video frames arrive without mipmaps; only pictures get them.
          if (!video) texture.minFilter = LinearMipmapLinearFilter;
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
      // A disposed texture still bound would re-upload its closed bitmap.
      if (loaded && uniforms.uMap.value === loaded) {
        uniforms.uMap.value = null;
        uniforms.uHasMap.value = 0;
      }
      loaded?.dispose();
    };
    // The player store parses a fresh map per revision; reload only on asset change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.asset.area, image?.asset.path, image?.widthPx, image?.heightPx, repository, reportError, uniforms]);

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

  useEffect(() => {
    uniforms.uFogMode.value = FOG_MODE_VALUE[fogMode];
  }, [fogMode, uniforms]);

  return uniforms;
}
