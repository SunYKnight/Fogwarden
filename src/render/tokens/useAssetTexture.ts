import { useEffect, useState } from 'react';
import type { Texture } from 'three';
import type { AssetRef } from '@/core/model';
import type { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { loadImageTexture } from '../loadImageTexture';

// Token pictures cover a few hundred pixels at most; full-size art would
// fill GPU memory with 30 different creatures on the map.
const MAX_TOKEN_TEXTURE_PX = 1024;

interface CachedTexture {
  refs: number;
  /** Null when loading failed; the error was reported once. */
  texture: Promise<Texture | null>;
}

const caches = new WeakMap<Repository, Map<string, CachedTexture>>();

function acquire(repository: Repository, ref: AssetRef, key: string): Promise<Texture | null> {
  const cache = caches.get(repository) ?? new Map<string, CachedTexture>();
  const entry = cache.get(key) ?? {
    refs: 0,
    texture: repository.storage
      .assetUrl(ref)
      .then((url) => loadImageTexture(url, null, MAX_TOKEN_TEXTURE_PX))
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
 * one texture, disposed when the last of them lets go.
 */
export function useAssetTexture(asset: AssetRef | null): Texture | null {
  const repository = useAppStore((s) => s.repository);
  const [loaded, setLoaded] = useState<{ key: string; texture: Texture | null } | null>(null);
  // Player sync sends new objects on every message; strings keep the texture.
  const area = asset?.area;
  const path = asset?.path;
  const key = `${area}:${path}`;

  useEffect(() => {
    let cancelled = false;
    const held = area && path ? `${area}:${path}` : null;
    if (area && path && held) {
      void acquire(repository, { area, path }, held).then((texture) => {
        if (!cancelled) setLoaded({ key: held, texture });
      });
    }
    return () => {
      cancelled = true;
      if (held) release(repository, held);
    };
  }, [area, path, repository]);

  return loaded && loaded.key === key ? loaded.texture : null;
}
