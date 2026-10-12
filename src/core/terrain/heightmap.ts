import { decodePng, encodePng } from '../png';

/** Maps a heightmap pixel value to feet: height = baseFt + value * feetPerUnit. */
export interface HeightmapScale {
  baseFt: number;
  feetPerUnit: number;
}

const MIN_EXPONENT = -16;
const MAX_VALUE = 0xffff;
// Quantized heights below 2^23 units stay exact as Float32 with a spare bit.
const MAX_UNITS = 2 ** 23;
// A flat field's scale depends on its height alone, so a re-encode keeps it.
const FLAT_UNITS = 2 ** 22;

/** Smallest power-of-two step at which `min`..`max` fits 16 bits and every height stays exact. */
function fineExponent(min: number, max: number): number {
  let exponent = MIN_EXPONENT;
  let fits = false;
  while (!fits) {
    const step = 2 ** exponent;
    const low = Math.round(min / step);
    const high = Math.round(max / step);
    fits = high - low <= MAX_VALUE && Math.max(Math.abs(low), Math.abs(high)) < MAX_UNITS;
    exponent += fits ? 0 : 1;
  }
  return exponent;
}

/**
 * Encodes heights (feet, row-major) as a 16-bit grayscale PNG. Heights are rounded to the finest
 * power-of-two step that fits, then the step grows while every value stays on it, so the scale only
 * depends on the decoded heights: decoding and encoding again reproduces the same PNG and scale.
 */
export async function encodeHeightmap(
  heights: Float32Array,
  cols: number,
  rows: number,
): Promise<{ png: Uint8Array; scale: HeightmapScale }> {
  if (heights.length !== cols * rows) {
    throw new Error(`Heightmap ${cols}x${rows} needs ${cols * rows} heights, got ${heights.length}`);
  }
  let min = Infinity;
  let max = -Infinity;
  for (const height of heights) {
    if (!Number.isFinite(height)) {
      throw new Error(`Heightmap contains the non-finite height ${height}`);
    }
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  const fine = fineExponent(min, max);
  const lowest = Math.round(min / 2 ** fine);
  const samples = Uint16Array.from(heights, (height) => Math.round(height / 2 ** fine) - lowest);
  const common = samples.reduce((bits, value) => bits | value, 0);
  let shift = 0;
  while (common !== 0 && ((common >> shift) & 1) === 0) {
    shift++;
  }
  samples.forEach((value, i) => {
    samples[i] = value >> shift;
  });
  let exponent = fine + shift;
  if (common === 0) {
    exponent = MIN_EXPONENT;
    while (Math.abs(lowest * 2 ** fine) >= FLAT_UNITS * 2 ** exponent) {
      exponent++;
    }
  }
  const png = await encodePng({ width: cols, height: rows, channels: 1, bitDepth: 16, samples });
  return { png, scale: { baseFt: lowest * 2 ** fine, feetPerUnit: 2 ** exponent } };
}

/**
 * Decodes a heightmap PNG. Hand edits saved at a lower bit depth scale up to 16 bits; color images use
 * their first channel because luminance weights would distort the heights.
 */
export async function decodeHeightmap(
  png: Uint8Array,
  scale: HeightmapScale,
  cols: number,
  rows: number,
): Promise<Float32Array> {
  const image = await decodePng(png);
  if (image.width !== cols || image.height !== rows) {
    throw new Error(`Heightmap image is ${image.width}x${image.height}, the terrain needs ${cols}x${rows}`);
  }
  // 65535 / (2^bits - 1) is an integer for every PNG bit depth.
  const toUnits = MAX_VALUE / (2 ** image.bitDepth - 1);
  const heights = new Float32Array(cols * rows);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = scale.baseFt + image.samples[i * image.channels]! * toUnits * scale.feetPerUnit;
  }
  return heights;
}
