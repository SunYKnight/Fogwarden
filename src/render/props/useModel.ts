import { useEffect, useState } from 'react';
import { LoadingManager, Mesh, type Material, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetRef } from '@/core/model';
import type { Storage } from '@/data/storage';
import { useAppStore } from '@/state/appStore';
import { modelSideFiles } from '@/sync/relayClient';

// One parse per file; every prop gets its own clone of the scene.
const loads = new Map<string, Promise<GLTF>>();

async function fetchGltf(storage: Storage, asset: AssetRef, url: string): Promise<GLTF> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot read the model ${asset.path}: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  // Storage URLs (desktop asset protocol, blob URLs) do not resolve relative
  // paths, so each file the model names gets its own storage URL.
  const sides = await Promise.all(
    modelSideFiles(asset, new Uint8Array(bytes)).map(async (side): Promise<[string, string]> => [
      side.uri,
      await storage.assetUrl(side.ref),
    ]),
  );
  const urls = new Map(sides);
  const manager = new LoadingManager().setURLModifier((uri) => urls.get(uri) ?? uri);
  const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
  // Leaf cards exported as blended shade every hidden pixel for every light;
  // cut out at half alpha they are discarded first. Glass (opacity) blends.
  gltf.scene.traverse((child) => {
    if (child instanceof Mesh) {
      [child.material].flat().forEach((material: Material) => {
        if (material.transparent && material.opacity === 1 && 'map' in material && material.map) {
          material.transparent = false;
          material.alphaTest = 0.5;
          material.depthWrite = true;
        }
      });
    }
  });
  return gltf;
}

/** The parsed glTF/GLB stored at `asset`; clone its scene before adding it anywhere. */
export async function loadGltf(storage: Storage, asset: AssetRef): Promise<GLTF> {
  // Keyed by URL: the same path names another file after a data root switch.
  const url = await storage.assetUrl(asset);
  const cached = loads.get(url);
  const load = cached ?? fetchGltf(storage, asset, url);
  if (!cached) {
    loads.set(url, load);
    // A failed load is retried next time; callers still get the error.
    load.catch(() => loads.delete(url));
  }
  return load;
}

/** Shadow-receiving clone of a stored glTF/GLB model's scene, or null while it loads. */
export function useModel(asset: AssetRef): Object3D | null {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [model, setModel] = useState<{ key: string; object: Object3D } | null>(null);
  const { area, path } = asset;
  const key = `${area}:${path}`;

  useEffect(() => {
    let cancelled = false;
    loadGltf(repository.storage, { area, path })
      .then((gltf) => {
        const object = clone(gltf.scene);
        object.traverse((child) => {
          if (child instanceof Mesh) {
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
