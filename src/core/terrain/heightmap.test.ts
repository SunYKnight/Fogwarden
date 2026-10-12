import { describe, expect, it } from 'vitest';
import { encodePng } from '../png';
import { decodeHeightmap, encodeHeightmap } from './heightmap';

const COLS = 21;
const ROWS = 17;

function field(value: (i: number) => number): Float32Array {
  return Float32Array.from({ length: COLS * ROWS }, (_, i) => value(i));
}

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
}

async function roundTrip(heights: Float32Array) {
  const encoded = await encodeHeightmap(heights, COLS, ROWS);
  const decoded = await decodeHeightmap(encoded.png, encoded.scale, COLS, ROWS);
  return { ...encoded, decoded };
}

describe('heightmap', () => {
  it('keeps random heights within half a unit and re-encodes identically', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = pseudoRandom(seed);
      const heights = field(() => (random() - 0.5) * 600);
      const { png, scale, decoded } = await roundTrip(heights);
      heights.forEach((height, i) => {
        expect(Math.abs(decoded[i]! - height)).toBeLessThanOrEqual(scale.feetPerUnit / 2);
      });
      const again = await encodeHeightmap(decoded, COLS, ROWS);
      expect(again.scale).toEqual(scale);
      expect(again.png).toEqual(png);
    }
  });

  it('re-encodes identically when the range barely fits', async () => {
    // Overflows 16 bits at 1/128 ft; its 1/64 ft rounding would not.
    const heights = field((i) => (i === 0 ? 0.6 / 64 : i === 1 ? (32768 + 0.3) / 64 : 1));
    const { png, scale, decoded } = await roundTrip(heights);
    const again = await encodeHeightmap(decoded, COLS, ROWS);
    expect(again.scale).toEqual(scale);
    expect(again.png).toEqual(png);
  });

  it('round-trips integer, half-step and negative fields bit-exactly', async () => {
    const random = pseudoRandom(9);
    const fields = [
      field(() => Math.round((random() - 0.5) * 600)),
      field(() => Math.round((random() - 0.5) * 100) / 2),
      field(() => -Math.round(random() * 250) - 0.25),
    ];
    for (const heights of fields) {
      const { decoded } = await roundTrip(heights);
      expect(decoded).toEqual(heights);
    }
    expect((await roundTrip(fields[0]!)).scale.feetPerUnit).toBe(1);
    expect((await roundTrip(fields[1]!)).scale.feetPerUnit).toBe(0.5);
  });

  it('stores a flat field as zeros at the finest step', async () => {
    for (const level of [0, 12.5]) {
      const heights = field(() => level);
      const { png, scale, decoded } = await roundTrip(heights);
      expect(scale).toEqual({ baseFt: level, feetPerUnit: 2 ** -16 });
      expect(decoded).toEqual(heights);
      expect((await encodeHeightmap(decoded, COLS, ROWS)).png).toEqual(png);
    }
  });

  it('re-encodes a flat field far from zero identically', async () => {
    const heights = field(() => 1000.0001);
    const { png, scale, decoded } = await roundTrip(heights);
    expect(Math.abs(decoded[0]! - heights[0]!)).toBeLessThanOrEqual(scale.feetPerUnit / 2);
    const again = await encodeHeightmap(decoded, COLS, ROWS);
    expect(again.scale).toEqual(scale);
    expect(again.png).toEqual(png);
  });

  it('reads 8-bit gray and RGB hand edits', async () => {
    const scale = { baseFt: -10, feetPerUnit: 2 ** -8 };
    const gray = Uint16Array.from({ length: COLS * ROWS }, (_, i) => i % 256);
    const grayPng = await encodePng({ width: COLS, height: ROWS, channels: 1, bitDepth: 8, samples: gray });
    const fromGray = await decodeHeightmap(grayPng, scale, COLS, ROWS);
    expect(fromGray[5]).toBe(-10 + 5 * 257 * 2 ** -8);
    const rgb = Uint16Array.from({ length: COLS * ROWS * 3 }, (_, i) => (i % 3 === 0 ? 200 : 7));
    const rgbPng = await encodePng({ width: COLS, height: ROWS, channels: 3, bitDepth: 8, samples: rgb });
    const fromRgb = await decodeHeightmap(rgbPng, scale, COLS, ROWS);
    expect(fromRgb[3]).toBe(-10 + 200 * 257 * 2 ** -8);
  });

  it('rejects an image of another size and a height count that does not match', async () => {
    const { png, scale } = await encodeHeightmap(
      field(() => 1),
      COLS,
      ROWS,
    );
    await expect(decodeHeightmap(png, scale, COLS + 1, ROWS)).rejects.toThrow(
      `Heightmap image is ${COLS}x${ROWS}, the terrain needs ${COLS + 1}x${ROWS}`,
    );
    await expect(encodeHeightmap(new Float32Array(3), 2, 2)).rejects.toThrow(/needs 4 heights/);
  });
});
