import { useEffect, useState } from 'react';
import type { Texture } from 'three';
import { defaultGraphicsSettings, type AssetRef } from '@/core/model';
import type { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { loadImageTexture } from '../loadImageTexture';
import { tokenTextureEdgePx } from '../textureLimits';

interface CachedTexture {
  refs: number;
  /** Null when loading failed; the error was reported once. */
  texture: Promise<Texture | null>;
}

const caches = new WeakMap<Repository, Map<string, CachedTexture>>();

function acquire(repository: Repository, ref: AssetRef, key: string, maxEdgePx: number): Promise<Texture | null> {
  const cache = caches.get(repository) ?? new Map<string, CachedTexture>();
  const entry = cache.get(key) ?? {
    refs: 0,
    texture: repository.storage
      .assetUrl(ref)
      .then((url) => loadImageTexture(url, null, maxEdgePx))
      .catch((error: unknown) => {
        useAppStore.getState().reportError(error);
        return null;
      }),
  };
  entry.refs += 1;
  cache.set(key, entry);
  caches.set(repository, cache);
  return entry.texture;
}

function release(repository: Repository, key: string): void {
  const cache = caches.get(repository);
  const entry = cache?.get(key);
  if (cache && entry) {
    entry.refs -= 1;
    if (entry.refs === 0) {
      cache.delete(key);
      void entry.texture.then((texture) => texture?.dispose());
    }
  }
}

/**
 * Texture for a storage asset, null while loading or without asset. Tokens showing the same asset share
 * one texture, disposed when the last of them lets go; a new texture size setting loads it again.
 */
export function useAssetTexture(asset: AssetRef | null): Texture | null {
  const repository = useAppStore((s) => s.repository);
  // Player windows load no settings and keep the defaults.
  const textureSizePx =
    useAppStore((s) => s.settings?.graphics.textureSizePx) ?? defaultGraphicsSettings().textureSizePx;
  const edgePx = tokenTextureEdgePx(textureSizePx);
  const [loaded, setLoaded] = useState<{ key: string; texture: Texture | null } | null>(null);
  // Player sync sends new objects on every message; strings keep the texture.
  const area = asset?.area;
  const path = asset?.path;
  const key = `${area}:${path}@${edgePx}`;

  useEffect(() => {
    let cancelled = false;
    const held = area && path ? `${area}:${path}@${edgePx}` : null;
    if (area && path && held) {
      void acquire(repository, { area, path }, held, edgePx).then((texture) => {
        if (!cancelled) setLoaded({ key: held, texture });
      });
    }
    return () => {
      cancelled = true;
      if (held) release(repository, held);
    };
  }, [area, path, edgePx, repository]);

  return loaded && loaded.key === key ? loaded.texture : null;
}
