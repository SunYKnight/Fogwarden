import { BitSet } from '../binary';
import { decodePng, encodePng } from '../png';
import type { FogSize } from './fog';

/** Encodes fog bits as a 1-bit grayscale PNG, one pixel per cell from the north-west corner, white = set. */
export async function encodeFogMask(bits: BitSet, size: FogSize): Promise<Uint8Array> {
  const cells = size.cellsX * size.cellsY;
  if (bits.size !== cells) {
    throw new Error(`Fog mask ${size.cellsX}x${size.cellsY} needs ${cells} bits, got ${bits.size}`);
  }
  const samples = Uint16Array.from({ length: cells }, (_, i) => (bits.get(i) ? 1 : 0));
  return encodePng({ width: size.cellsX, height: size.cellsY, channels: 1, bitDepth: 1, samples });
}

/**
 * Decodes a fog mask PNG at any bit depth so hand edits load: a cell is set when its gray or first color
 * value is at least half the maximum; alpha is ignored.
 */
export async function decodeFogMask(png: Uint8Array, size: FogSize): Promise<BitSet> {
  const image = await decodePng(png);
  if (image.width !== size.cellsX || image.height !== size.cellsY) {
    throw new Error(`Fog mask image is ${image.width}x${image.height}, the map needs ${size.cellsX}x${size.cellsY}`);
  }
  const max = 2 ** image.bitDepth - 1;
  const bits = new BitSet(size.cellsX * size.cellsY);
  for (let i = 0; i < bits.size; i++) {
    bits.set(i, image.samples[i * image.channels]! * 2 >= max);
  }
  return bits;
}
