import { useEffect, useState } from 'react';
import { LoadingManager, Mesh, Texture, type Material, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { defaultGraphicsSettings, type AssetRef } from '@/core/model';
import { reducedImageSize } from '@/core/terrain/calibration';
import type { Storage } from '@/data/storage';
import { useAppStore } from '@/state/appStore';
import { modelSideFiles } from '@/sync/relayClient';

interface CachedGltf {
  /** Longest texture edge; null keeps the stored textures (exports). */
  maxEdgePx: number | null;
  load: Promise<GLTF>;
  /** Set once loaded, so an unused model can be freed. */
  gltf: GLTF | null;
  /** Mounted props showing a clone of the scene. */
  users: number;
}

// One parse per file and texture size; every prop gets its own clone of the scene.
const loads = new Map<string, CachedGltf>();

/** Materials of every mesh in `scene`, each once. */
function sceneMaterials(scene: Object3D): Set<Material> {
  const materials = new Set<Material>();
  scene.traverse((child) => {
    if (child instanceof Mesh) {
      [child.material].flat().forEach((material: Material) => materials.add(material));
    }
  });
  return materials;
}

/** Texture maps (color, normal, roughness, ...) among a material's fields. */
const isTexture = (value: unknown): value is Texture => value instanceof Texture;

/**
 * Replaces every texture image of `scene` longer than `maxEdgePx` with a scaled-down copy before the first
 * upload; Poly Haven and Dungeon Alchemist models bring 4K maps that dominate GPU memory.
 */
async function downscaleTextures(scene: Object3D, maxEdgePx: number): Promise<void> {
  const sources = new Set(
    [...sceneMaterials(scene)].flatMap((material) => Object.values(material).filter(isTexture)).map((t) => t.source),
  );
  await Promise.all(
    [...sources].map(async (source) => {
      const image: unknown = source.data;
      const bitmapSource = image instanceof ImageBitmap || image instanceof HTMLImageElement ? image : null;
      const reduced = bitmapSource
        ? reducedImageSize({ widthPx: bitmapSource.width, heightPx: bitmapSource.height }, maxEdgePx)
        : null;
      if (bitmapSource && reduced) {
        // glTF textures are not premultiplied; keep the loader's alpha as is.
        source.data = await createImageBitmap(bitmapSource, {
          resizeWidth: reduced.widthPx,
          resizeHeight: reduced.heightPx,
          resizeQuality: 'high',
          premultiplyAlpha: 'none',
        });
        source.needsUpdate = true;
        if (bitmapSource instanceof ImageBitmap) bitmapSource.close();
      }
    }),
  );
}

/** Frees the GPU buffers, textures and decoded images of a model no prop shows. */
function disposeGltf(gltf: GLTF): void {
  gltf.scene.traverse((child) => {
    if (child instanceof Mesh) child.geometry.dispose();
  });
  sceneMaterials(gltf.scene).forEach((material) => {
    Object.values(material)
      .filter(isTexture)
      .forEach((texture) => {
        texture.dispose();
        const image: unknown = texture.source.data;
        if (image instanceof ImageBitmap) image.close();
      });
    material.dispose();
  });
}

async function fetchGltf(storage: Storage, asset: AssetRef, url: string, maxEdgePx: number | null): Promise<GLTF> {
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
  if (maxEdgePx !== null) await downscaleTextures(gltf.scene, maxEdgePx);
  return gltf;
}

/** Frees the parsed models of other texture sizes that no prop shows any more. */
function dropUnused(maxEdgePx: number): void {
  for (const [key, entry] of loads) {
    if (entry.users === 0 && entry.maxEdgePx !== null && entry.maxEdgePx !== maxEdgePx) {
      loads.delete(key);
      if (entry.gltf) disposeGltf(entry.gltf);
    }
  }
}

function cachedGltf(storage: Storage, asset: AssetRef, url: string, maxEdgePx: number | null): CachedGltf {
  // Keyed by URL: the same path names another file after a data root switch.
  const key = `${maxEdgePx ?? 'stored'}|${url}`;
  const cached = loads.get(key);
  const entry = cached ?? { maxEdgePx, load: fetchGltf(storage, asset, url, maxEdgePx), gltf: null, users: 0 };
  if (!cached) {
    loads.set(key, entry);
    // A failed load is retried next time; callers still get the error.
    entry.load.then(
      (gltf) => {
        entry.gltf = gltf;
      },
      () => loads.delete(key),
    );
  }
  return entry;
}

/**
 * The parsed glTF/GLB stored at `asset` with textures at most `maxEdgePx` long (null keeps them as stored);
 * clone its scene before adding it anywhere.
 */
export async function loadGltf(storage: Storage, asset: AssetRef, maxEdgePx: number | null): Promise<GLTF> {
  return cachedGltf(storage, asset, await storage.assetUrl(asset), maxEdgePx).load;
}

/**
 * Shadow-receiving clone of a stored glTF/GLB model's scene, or null while it loads. A new texture size
 * setting loads the model again and frees the old one once no prop shows it.
 */
export function useModel(asset: AssetRef): Object3D | null {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  // Player windows load no settings and keep the defaults.
  const textureSizePx =
    useAppStore((s) => s.settings?.graphics.textureSizePx) ?? defaultGraphicsSettings().textureSizePx;
  const [model, setModel] = useState<{ key: string; object: Object3D } | null>(null);
  const { area, path } = asset;
  const key = `${area}:${path}@${textureSizePx}`;

  useEffect(() => {
    let cancelled = false;
    let held: CachedGltf | null = null;
    repository.storage
      .assetUrl({ area, path })
      .then((url) => {
        held = cancelled ? null : cachedGltf(repository.storage, { area, path }, url, textureSizePx);
        if (held) held.users += 1;
        dropUnused(textureSizePx);
        return held?.load ?? null;
      })
      .then((gltf) => {
        const object = gltf && !cancelled ? clone(gltf.scene) : null;
        object?.traverse((child) => {
          if (child instanceof Mesh) {
            child.receiveShadow = true;
          }
        });
        if (object) setModel({ key: `${area}:${path}@${textureSizePx}`, object });
      })
      .catch(reportError);
    return () => {
      cancelled = true;
      if (held) {
        held.users -= 1;
        // The setting already holds the new size when the old model lets go.
        dropUnused(useAppStore.getState().settings?.graphics.textureSizePx ?? defaultGraphicsSettings().textureSizePx);
      }
    };
  }, [area, path, textureSizePx, repository, reportError]);

  return model?.key === key ? model.object : null;
}
