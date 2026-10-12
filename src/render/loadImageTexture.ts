import { SRGBColorSpace, Texture } from 'three';

/** Largest texture edge uploaded: 4096 px still gives ~80 px per square on a 50-square map. */
export const MAX_TEXTURE_PX = 4096;

/**
 * Decodes an image off the main thread (createImageBitmap) into a texture. With a known pixel size,
 * images larger than `MAX_TEXTURE_PX` are scaled down during decoding, so a 15000 px battlemap never
 * exists at full size in memory or on the GPU.
 */
export async function loadImageTexture(
  url: string,
  sizePx: { widthPx: number; heightPx: number } | null,
): Promise<Texture> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}: ${url}`);
  }
  const blob = await response.blob();
  const scale = sizePx ? Math.min(1, MAX_TEXTURE_PX / Math.max(sizePx.widthPx, sizePx.heightPx)) : 1;
  const resize =
    sizePx && scale < 1
      ? { resizeWidth: Math.round(sizePx.widthPx * scale), resizeHeight: Math.round(sizePx.heightPx * scale) }
      : {};
  // Bitmaps ignore texture.flipY, so the flip happens while decoding.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', resizeQuality: 'high', ...resize });
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  texture.addEventListener('dispose', () => bitmap.close());
  return texture;
}
