import { useEffect, useState } from 'react';
import { Mesh, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';

// One parse per file; every prop gets its own clone of the scene.
const loads = new Map<string, Promise<GLTF>>();

/** The parsed glTF/GLB at `url`; clone its scene before adding it anywhere. */
export function loadGltf(url: string): Promise<GLTF> {
  const cached = loads.get(url);
  const load = cached ?? new GLTFLoader().loadAsync(url);
  if (!cached) {
    loads.set(url, load);
    // A failed load is retried next time; callers still get the error.
    load.catch(() => loads.delete(url));
  }
  return load;
}

/** Shadow-casting clone of a stored glTF/GLB model's scene, or null while it loads. */
export function useModel(asset: AssetRef): Object3D | null {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [model, setModel] = useState<{ key: string; object: Object3D } | null>(null);
  const { area, path } = asset;
  const key = `${area}:${path}`;

  useEffect(() => {
    let cancelled = false;
    repository.storage
      .assetUrl({ area, path })
      .then(loadGltf)
      .then((gltf) => {
        const object = clone(gltf.scene);
        object.traverse((child) => {
          if (child instanceof Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        if (!cancelled) setModel({ key: `${area}:${path}`, object });
      })
      .catch(reportError);
    return () => {
      cancelled = true;
    };
  }, [area, path, repository, reportError]);

  return model?.key === key ? model.object : null;
}
