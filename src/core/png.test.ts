import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, PngError, readPngSize, type PngImage } from './png';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Chunk built with node's zlib CRC, independent of the codec under test. */
function nodeChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

interface NodePng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Scanlines including their filter type bytes. */
  scanlines: Uint8Array;
  interlaced?: boolean;
  /** Chunks placed between IHDR and the image data. */
  extra?: [string, Uint8Array][];
  /** Number of IDAT chunks the zlib stream is split into. */
  idatCount?: number;
}

/** PNG assembled the way the former node:zlib-based encoder did. */
function nodePng(spec: NodePng): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(spec.width, 0);
  header.writeUInt32BE(spec.height, 4);
  header.set([spec.bitDepth, spec.colorType, 0, 0, spec.interlaced ? 1 : 0], 8);
  const stream = deflateSync(spec.scanlines, { level: 9 });
  const count = spec.idatCount ?? 1;
  const part = Math.ceil(stream.length / count);
  const idat = Array.from({ length: count }, (_, i) => nodeChunk('IDAT', stream.subarray(i * part, (i + 1) * part)));
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    nodeChunk('IHDR', header),
    ...(spec.extra ?? []).map(([type, data]) => nodeChunk(type, data)),
    ...idat,
    nodeChunk('IEND', new Uint8Array(0)),
  ]);
}

/** Unfiltered scanlines (filter type 0) of 8-bit samples. */
function plainScanlines(samples: number[], stride: number): Uint8Array {
  const rows = samples.length / stride;
  return Uint8Array.from({ length: rows * (stride + 1) }, (_, i) => {
    const column = i % (stride + 1);
    return column === 0 ? 0 : samples[Math.floor(i / (stride + 1)) * stride + column - 1]!;
  });
}

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
}

function randomImage(width: number, height: number, channels: PngImage['channels'], bitDepth: PngImage['bitDepth']) {
  const random = pseudoRandom(width * 31 + height * 7 + channels * 3 + bitDepth);
  const max = 2 ** bitDepth;
  // Smooth gradients plus noise give every row filter a chance to win.
  const samples = Uint16Array.from({ length: width * height * channels }, (_, i) =>
    random() < 0.5 ? (i * 13) % max : Math.floor(random() * max),
  );
  return { width, height, channels, bitDepth, samples };
}

describe('encodePng / decodePng', () => {
  const formats: [PngImage['channels'], PngImage['bitDepth']][] = [
    [1, 1],
    [1, 2],
    [1, 4],
    [1, 8],
    [1, 16],
    [2, 8],
    [2, 16],
    [3, 8],
    [3, 16],
    [4, 8],
    [4, 16],
  ];

  it.each(formats)('round-trips %i channels at %i bits', async (channels, bitDepth) => {
    const image = randomImage(13, 7, channels, bitDepth);
    expect(await decodePng(await encodePng(image))).toEqual(image);
  });

  it('writes a zlib stream and header node can read', async () => {
    const image = randomImage(9, 4, 3, 8);
    const png = await encodePng(image);
    const view = new DataView(png.buffer, png.byteOffset);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw.length).toBe((9 * 3 + 1) * 4);
    expect(readPngSize(png)).toEqual({ width: 9, height: 4 });
  });

  it('rejects samples that do not match the image', async () => {
    const samples = new Uint16Array(5);
    await expect(encodePng({ width: 2, height: 2, channels: 3, bitDepth: 8, samples })).rejects.toThrow(
      /Expected 12 samples/,
    );
    const tooLarge = Uint16Array.of(0, 2);
    await expect(encodePng({ width: 2, height: 1, channels: 1, bitDepth: 1, samples: tooLarge })).rejects.toThrow(
      PngError,
    );
    await expect(encodePng({ width: 1, height: 1, channels: 3, bitDepth: 4, samples })).rejects.toThrow(
      /3 channels at 4 bits/,
    );
  });
});

describe('decodePng', () => {
  it('reads RGB written by node zlib in several IDAT chunks around ancillary chunks', async () => {
    const pixels = Array.from({ length: 5 * 3 * 3 }, (_, i) => (i * 37) & 0xff);
    const png = nodePng({
      width: 5,
      height: 3,
      bitDepth: 8,
      colorType: 2,
      scanlines: plainScanlines(pixels, 15),
      extra: [
        ['gAMA', Uint8Array.of(0, 0, 0xb1, 0x8f)],
        ['tEXt', new TextEncoder().encode('Software\0test')],
      ],
      idatCount: 3,
    });
    expect(await decodePng(png)).toEqual({
      width: 5,
      height: 3,
      channels: 3,
      bitDepth: 8,
      samples: Uint16Array.from(pixels),
    });
  });

  it('reverses each filter type', async () => {
    const scanlines = Uint8Array.of(
      ...[0, 10, 20, 250],
      ...[1, 5, 5, 251],
      ...[2, 1, 1, 1],
      ...[3, 3, 3, 3],
      ...[4, 1, 1, 1],
    );
    const png = nodePng({ width: 3, height: 5, bitDepth: 8, colorType: 0, scanlines });
    const { samples } = await decodePng(png);
    expect(Array.from(samples)).toEqual([10, 20, 250, 5, 10, 5, 6, 11, 6, 6, 11, 11, 7, 12, 13]);
  });

  it('expands a 2-bit palette with tRNS to RGBA and an 8-bit palette to RGB', async () => {
    const palette = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255);
    const indexed = nodePng({
      width: 3,
      height: 1,
      bitDepth: 2,
      colorType: 3,
      scanlines: Uint8Array.of(0, 0b00011000),
      extra: [
        ['PLTE', palette],
        ['tRNS', Uint8Array.of(128)],
      ],
    });
    expect(await decodePng(indexed)).toEqual({
      width: 3,
      height: 1,
      channels: 4,
      bitDepth: 8,
      samples: Uint16Array.of(255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255),
    });
    const opaque = nodePng({
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: 3,
      scanlines: Uint8Array.of(0, 2, 1),
      extra: [['PLTE', palette]],
    });
    expect(Array.from((await decodePng(opaque)).samples)).toEqual([0, 0, 255, 0, 255, 0]);
  });

  it('rejects a palette index beyond the palette', async () => {
    const png = nodePng({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 3,
      scanlines: Uint8Array.of(0, 3),
      extra: [['PLTE', Uint8Array.of(1, 2, 3)]],
    });
    await expect(decodePng(png)).rejects.toThrow(/palette index 3/);
  });

  it('reads gray+alpha at 8 bits and RGBA at 16 bits', async () => {
    const grayAlpha = nodePng({
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: 4,
      scanlines: Uint8Array.of(0, 40, 255, 200, 0),
    });
    expect(await decodePng(grayAlpha)).toMatchObject({
      channels: 2,
      bitDepth: 8,
      samples: Uint16Array.of(40, 255, 200, 0),
    });
    const rgba = nodePng({
      width: 1,
      height: 1,
      bitDepth: 16,
      colorType: 6,
      scanlines: Uint8Array.of(0, 0x12, 0x34, 0xff, 0xff, 0, 1, 0x80, 0),
    });
    expect(await decodePng(rgba)).toMatchObject({
      channels: 4,
      bitDepth: 16,
      samples: Uint16Array.of(0x1234, 0xffff, 1, 0x8000),
    });
  });

  it('reads Adam7-interlaced images', async () => {
    const width = 11;
    const height = 9;
    const pixels = Array.from({ length: width * height }, (_, i) => (i * 7) & 0xff);
    const passes = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ];
    const scanlines: number[] = [];
    for (const [x0, y0, dx, dy] of passes) {
      for (let y = y0!; y < height; y += dy!) {
        scanlines.push(0);
        for (let x = x0!; x < width; x += dx!) {
          scanlines.push(pixels[y * width + x]!);
        }
      }
    }
    const png = nodePng({
      width,
      height,
      bitDepth: 8,
      colorType: 0,
      scanlines: Uint8Array.from(scanlines),
      interlaced: true,
    });
    expect(Array.from((await decodePng(png)).samples)).toEqual(pixels);
  });

  it('rejects a wrong CRC, a missing signature, corrupt data and unknown critical chunks', async () => {
    const png = await encodePng(randomImage(4, 4, 1, 8));
    const damaged = png.slice();
    damaged[45]! ^= 0xff;
    await expect(decodePng(damaged)).rejects.toThrow(/IDAT has a wrong CRC/);
    await expect(decodePng(png.subarray(1))).rejects.toThrow(PngError);
    expect(() => readPngSize(new Uint8Array(4))).toThrow(/Not a PNG/);
    const garbage = nodePng({ width: 1, height: 1, bitDepth: 8, colorType: 0, scanlines: Uint8Array.of(0, 1) });
    const corrupt = Buffer.concat([
      garbage.subarray(0, 33),
      nodeChunk('IDAT', Uint8Array.of(1, 2, 3, 4)),
      nodeChunk('IEND', new Uint8Array(0)),
    ]);
    await expect(decodePng(corrupt)).rejects.toThrow(/corrupt/);
    const unknown = nodePng({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 0,
      scanlines: Uint8Array.of(0, 1),
      extra: [['ABCD', new Uint8Array(1)]],
    });
    await expect(decodePng(unknown)).rejects.toThrow(/ABCD is not supported/);
  });
});
