import { useEffect, useState } from 'react';
import type { Texture } from 'three';
import type { AssetRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { loadImageTexture } from '../loadImageTexture';

/** Texture for a storage asset, null while loading or without asset; disposed when the asset changes. */
export function useAssetTexture(asset: AssetRef | null): Texture | null {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [loaded, setLoaded] = useState<{ key: string; texture: Texture } | null>(null);
  // Player sync sends new objects on every message; strings keep the texture.
  const area = asset?.area;
  const path = asset?.path;
  const key = `${area}:${path}`;

  useEffect(() => {
    let cancelled = false;
    let texture: Texture | null = null;
    if (area && path) {
      repository.storage
        .assetUrl({ area, path })
        .then((url) => loadImageTexture(url, null))
        .then((result) => {
          texture = result;
          if (cancelled) {
            result.dispose();
          } else {
            setLoaded({ key: `${area}:${path}`, texture: result });
          }
        })
        .catch(reportError);
    }
    return () => {
      cancelled = true;
      texture?.dispose();
    };
  }, [area, path, repository, reportError]);

  return loaded && loaded.key === key ? loaded.texture : null;
}
