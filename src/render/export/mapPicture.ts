import type { BattleMap, SideMaterial } from '@/core/model';
import { MAX_TEXTURE_PX } from '../loadImageTexture';
import { sideTexture } from '../materials/sideTextures';
import type { EncodedImage } from './mapGlb';

// Maps without a battlemap still get a readable grid.
const BLANK_PX_PER_SQUARE = 100;
// Keeps grid lines and lettering of painted battlemaps free of artefacts.
const JPEG_QUALITY = 0.9;
const DEG = Math.PI / 180;

/** The battlemap seen from above: pixel (0, 0) is the map's north-west corner. */
export interface MapPicture extends EncodedImage {
  pxPerSquare: number;
}

/**
 * Draws the map's squares as one picture, aligned to the grid: the battlemap turned and moved by
 * its calibration over the ground color, at most `MAX_TEXTURE_PX` on the long edge, with the grid
 * lines on request.
 */
export async function renderMapPicture(
  map: BattleMap,
  battlemap: CanvasImageSource | null,
  options: { grid: boolean; mimeType: EncodedImage['mimeType'] },
): Promise<MapPicture> {
  const { grid, image } = map;
  const own = image && battlemap ? grid.pxPerSquare : BLANK_PX_PER_SQUARE;
  const pxPerSquare = Math.min(own, MAX_TEXTURE_PX / Math.max(grid.squaresX, grid.squaresY));
  const width = Math.max(1, Math.round(grid.squaresX * pxPerSquare));
  const height = Math.max(1, Math.round(grid.squaresY * pxPerSquare));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('This system cannot draw images off screen to export the map');
  }
  context.fillStyle = map.terrain.baseColor;
  context.fillRect(0, 0, width, height);
  if (image && battlemap) {
    // Inverse of the calibration: image pixels to map squares at this size.
    const zoom = pxPerSquare / grid.pxPerSquare;
    context.save();
    context.imageSmoothingQuality = 'high';
    context.scale(zoom, zoom);
    context.rotate(-grid.rotationDeg * DEG);
    context.translate(-grid.offsetPx.x, -grid.offsetPx.y);
    context.drawImage(battlemap, 0, 0, image.widthPx, image.heightPx);
    context.restore();
  }
  if (options.grid) {
    context.globalAlpha = grid.opacity;
    context.strokeStyle = grid.color;
    context.lineWidth = Math.max(1, pxPerSquare / 40);
    context.beginPath();
    for (let x = 0; x <= grid.squaresX; x++) {
      context.moveTo(x * pxPerSquare, 0);
      context.lineTo(x * pxPerSquare, height);
    }
    for (let y = 0; y <= grid.squaresY; y++) {
      context.moveTo(0, y * pxPerSquare);
      context.lineTo(width, y * pxPerSquare);
    }
    context.stroke();
  }
  const blob = await canvas.convertToBlob({ type: options.mimeType, quality: JPEG_QUALITY });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: options.mimeType, pxPerSquare };
}

/** The tileable wall and cliff texture the 3D view uses, as a PNG. */
export async function sideTextureImage(material: SideMaterial): Promise<EncodedImage> {
  const canvas = sideTexture(material).image as HTMLCanvasElement;
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`Cannot encode the ${material} texture`))));
  return { bytes: new Uint8Array(await (await promise).arrayBuffer()), mimeType: 'image/png' };
}
