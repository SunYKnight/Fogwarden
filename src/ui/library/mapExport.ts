import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { isVideoAsset } from '@/core/atmosphere/media';
import { formatUvtt } from '@/core/export/uvtt';
import type { BattleMap } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { writeFileBytes } from '@/data/tauriStorage';
import { exportMapGlb, type MapGlbSources } from '@/render/export/mapGlb';
import { renderMapPicture, sideTextureImage } from '@/render/export/mapPicture';
import { loadVideoTexture } from '@/render/loadVideoTexture';
import { loadGltf } from '@/render/props/useModel';
import { useAppStore } from '@/state/appStore';
import type { IconName } from '../kit';

export type MapExportFormat = 'glb' | 'uvtt' | 'png';

interface FormatInfo {
  label: string;
  extension: string;
  icon: IconName;
  description: string;
}

export const MAP_EXPORT_FORMATS: Record<MapExportFormat, FormatInfo> = {
  glb: {
    label: '3D model',
    extension: 'glb',
    icon: 'cube',
    description: 'Terrain with the battlemap, walls, doors, roofs and props, for Blender and other 3D tools.',
  },
  uvtt: {
    label: 'Universal VTT',
    extension: 'dd2vtt',
    icon: 'map',
    description: 'Walls, doors, lights and the picture, for Foundry, Owlbear Rodeo and other virtual tabletops.',
  },
  png: {
    label: 'Image',
    extension: 'png',
    icon: 'image',
    description: 'The battlemap as one picture, cut and turned to the grid.',
  },
};

export interface MapExportOptions {
  /** 3D model: map lights as glTF point lights. */
  lights: boolean;
  /** Image: grid lines drawn in. */
  grid: boolean;
}

/** Still exports take a video battlemap's first frame. */
async function videoFrame(url: string): Promise<ImageBitmap> {
  const texture = await loadVideoTexture(url);
  try {
    return await createImageBitmap(texture.image as HTMLVideoElement);
  } finally {
    texture.dispose();
  }
}

async function decodeBattlemap(map: BattleMap): Promise<ImageBitmap | null> {
  const { repository } = useAppStore.getState();
  let bitmap: ImageBitmap | null = null;
  if (map.image && isVideoAsset(map.image.asset)) {
    bitmap = await videoFrame(await repository.storage.assetUrl(map.image.asset));
  } else if (map.image) {
    const url = await repository.storage.assetUrl(map.image.asset);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`The battlemap could not be read (${response.status}): ${map.image.asset.path}`);
    }
    bitmap = await createImageBitmap(await response.blob());
  }
  return bitmap;
}

async function exportBytes(
  map: BattleMap,
  terrain: HeightField,
  format: MapExportFormat,
  options: MapExportOptions,
  battlemap: ImageBitmap | null,
): Promise<Uint8Array> {
  const { repository } = useAppStore.getState();
  let bytes: Uint8Array;
  switch (format) {
    case 'png':
      bytes = (await renderMapPicture(map, battlemap, { grid: options.grid, mimeType: 'image/png' })).bytes;
      break;
    case 'uvtt': {
      const picture = await renderMapPicture(map, battlemap, { grid: false, mimeType: 'image/jpeg' });
      bytes = new TextEncoder().encode(formatUvtt(map, picture));
      break;
    }
    case 'glb': {
      // The texture shows the grid when the 3D view does.
      const picture = await renderMapPicture(map, battlemap, { grid: map.grid.show, mimeType: 'image/jpeg' });
      const sources: MapGlbSources = {
        battlemap: picture,
        sideImage: sideTextureImage,
        // Exports keep the stored model textures whatever the graphics settings.
        model: async (asset) => clone((await loadGltf(repository.storage, asset, null)).scene),
      };
      bytes = await exportMapGlb(map, terrain, sources, { lights: options.lights });
      break;
    }
  }
  return bytes;
}

/** Saves `bytes` as a browser download named `fileName`. */
export function download(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Asks where to save (native save dialog; the browser downloads instead), then writes the map in
 * `format`. Resolves false when the user cancels the dialog.
 */
export async function exportMap(
  map: BattleMap,
  terrain: HeightField,
  format: MapExportFormat,
  options: MapExportOptions,
): Promise<boolean> {
  const { label, extension } = MAP_EXPORT_FORMATS[format];
  const fileName = `${map.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'map'}.${extension}`;
  const target = isTauri()
    ? await save({ defaultPath: fileName, filters: [{ name: label, extensions: [extension] }] })
    : fileName;
  if (target !== null) {
    const battlemap = await decodeBattlemap(map);
    try {
      const bytes = await exportBytes(map, terrain, format, options, battlemap);
      if (isTauri()) {
        await writeFileBytes(target, bytes);
      } else {
        download(fileName, bytes);
      }
    } finally {
      battlemap?.close();
    }
    useAppStore.getState().notify(`Exported "${target.split(/[\\/]/).at(-1)}"`);
  }
  return target !== null;
}
