import { describe, expect, it } from 'vitest';
import { BitSet } from '../binary';
import { decodePng, encodePng } from '../png';
import { decodeFogMask, encodeFogMask } from './fogMask';

const SIZE = { cellsX: 13, cellsY: 7, cellFt: 2.5 };

describe('fog mask', () => {
  it('round-trips a bit set whose width is not a multiple of 8', async () => {
    const bits = new BitSet(SIZE.cellsX * SIZE.cellsY);
    for (let i = 0; i < bits.size; i++) {
      bits.set(i, (i * 7) % 5 < 2);
    }
    const png = await encodeFogMask(bits, SIZE);
    expect(await decodeFogMask(png, SIZE)).toEqual(bits);
  });

  it('stores set bits as white pixels from the north-west corner', async () => {
    const bits = new BitSet(SIZE.cellsX * SIZE.cellsY);
    bits.set(1, true);
    bits.set(SIZE.cellsX, true);
    const image = await decodePng(await encodeFogMask(bits, SIZE));
    expect(image).toMatchObject({ width: SIZE.cellsX, height: SIZE.cellsY, channels: 1, bitDepth: 1 });
    expect(Array.from(image.samples.subarray(0, SIZE.cellsX + 1))).toEqual([
      0,
      1,
      ...Array(SIZE.cellsX - 2).fill(0),
      1,
    ]);
  });

  it('reads an 8-bit gray hand edit with half the maximum as threshold', async () => {
    const samples = Uint16Array.from({ length: SIZE.cellsX * SIZE.cellsY }, (_, i) => [0, 127, 128, 255][i % 4]!);
    const png = await encodePng({ width: SIZE.cellsX, height: SIZE.cellsY, channels: 1, bitDepth: 8, samples });
    const bits = await decodeFogMask(png, SIZE);
    for (let i = 0; i < bits.size; i++) {
      expect(bits.get(i)).toBe(i % 4 >= 2);
    }
  });

  it('rejects a mask of another size', async () => {
    const png = await encodeFogMask(new BitSet(SIZE.cellsX * SIZE.cellsY), SIZE);
    await expect(decodeFogMask(png, { ...SIZE, cellsY: 8 })).rejects.toThrow(
      'Fog mask image is 13x7, the map needs 13x8',
    );
    await expect(encodeFogMask(new BitSet(5), SIZE)).rejects.toThrow(/needs 91 bits, got 5/);
  });
});
