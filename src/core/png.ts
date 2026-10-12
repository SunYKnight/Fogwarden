/**
 * Dependency-free PNG codec for the app's own images (heightmaps, fog masks, generated maps). It runs in the
 * browser, the Tauri webview and node alike: deflate comes from the web-standard compression streams.
 */

export interface PngImage {
  width: number;
  height: number;
  /** 1 gray, 2 gray+alpha, 3 RGB, 4 RGBA. */
  channels: 1 | 2 | 3 | 4;
  bitDepth: 1 | 2 | 4 | 8 | 16;
  /** Row-major samples, `channels` per pixel, each 0..2^bitDepth-1. */
  samples: Uint16Array;
}

export class PngError extends Error {
  override name = 'PngError';
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COLOR_PALETTE = 3;
const FILTER_TYPES = 5;

/** PNG color type of each channel count the encoder writes. */
const COLOR_TYPE_OF_CHANNELS: Record<PngImage['channels'], number> = { 1: 0, 2: 4, 3: 2, 4: 6 };
/** Channels stored per pixel for each color type; palette pixels store one index. */
const CHANNELS_OF_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Bit depths the PNG specification allows per color type. */
const BIT_DEPTHS_OF_COLOR_TYPE: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** Sub-image of an interlacing pass: first pixel and step between pixels. */
interface Pass {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

const NON_INTERLACED: readonly Pass[] = [{ x0: 0, y0: 0, dx: 1, dy: 1 }];
const ADAM7: readonly Pass[] = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
];

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Runs `bytes` through a compression stream; 'deflate' is the zlib format PNG requires. */
async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const output = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(output);
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Prediction of filter `type` from the left (a), upper (b) and upper-left (c) bytes. */
function predictor(type: number, a: number, b: number, c: number): number {
  let value = 0;
  switch (type) {
    case 1:
      value = a;
      break;
    case 2:
      value = b;
      break;
    case 3:
      value = (a + b) >> 1;
      break;
    case 4:
      value = paeth(a, b, c);
      break;
  }
  return value;
}

/** Applies filter `type` to `row` with `prior` as the row above; `bpp` is the byte distance to the left pixel. */
function filterRow(type: number, row: Uint8Array, prior: Uint8Array, bpp: number, out: Uint8Array): void {
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0;
    const c = i >= bpp ? prior[i - bpp]! : 0;
    out[i] = (row[i]! - predictor(type, a, prior[i]!, c)) & 0xff;
  }
}

/** Reverses filter `type` on `row` in place; left bytes are already restored when they are read. */
function unfilterRow(type: number, row: Uint8Array, prior: Uint8Array, bpp: number): void {
  if (type >= FILTER_TYPES) {
    throw new PngError(`Unknown PNG filter type ${type}`);
  }
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0;
    const c = i >= bpp ? prior[i - bpp]! : 0;
    row[i] = (row[i]! + predictor(type, a, prior[i]!, c)) & 0xff;
  }
}

/** Sum of the filtered bytes read as signed values; smaller usually deflates better. */
function filterCost(bytes: Uint8Array): number {
  let cost = 0;
  for (const value of bytes) {
    cost += value < 128 ? value : 256 - value;
  }
  return cost;
}

/** Sample `index` of a packed row: big-endian for 16 bits, most significant bits first below 8. */
function readSample(row: Uint8Array, index: number, bitDepth: number): number {
  let value: number;
  switch (bitDepth) {
    case 16:
      value = (row[index * 2]! << 8) | row[index * 2 + 1]!;
      break;
    case 8:
      value = row[index]!;
      break;
    default: {
      const bit = index * bitDepth;
      value = (row[bit >> 3]! >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
    }
  }
  return value;
}

/** Writes sample `index` into a packed row; sub-byte samples are OR-ed into a zeroed row. */
function writeSample(row: Uint8Array, index: number, bitDepth: number, value: number): void {
  switch (bitDepth) {
    case 16:
      row[index * 2] = value >> 8;
      row[index * 2 + 1] = value & 0xff;
      break;
    case 8:
      row[index] = value;
      break;
    default: {
      const bit = index * bitDepth;
      row[bit >> 3]! |= value << (8 - bitDepth - (bit & 7));
    }
  }
}

function rowBytes(width: number, bitsPerPixel: number): number {
  return Math.ceil((width * bitsPerPixel) / 8);
}

/** Filters operate on whole bytes: sub-byte pixels compare with the previous byte. */
function filterDistance(bitsPerPixel: number): number {
  return Math.max(1, bitsPerPixel >> 3);
}

function validateImage(image: PngImage): void {
  const { width, height, channels, bitDepth, samples } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new PngError(`PNG size must be positive integers, got ${width}x${height}`);
  }
  const colorType = COLOR_TYPE_OF_CHANNELS[channels];
  if (colorType === undefined || !BIT_DEPTHS_OF_COLOR_TYPE[colorType]!.includes(bitDepth)) {
    throw new PngError(`PNG cannot store ${channels} channels at ${bitDepth} bits`);
  }
  if (samples.length !== width * height * channels) {
    throw new PngError(
      `Expected ${width * height * channels} samples for ${width}x${height}x${channels}, got ${samples.length}`,
    );
  }
  const max = 2 ** bitDepth - 1;
  if (samples.some((value) => value > max)) {
    throw new PngError(`PNG samples of ${bitDepth} bits must not exceed ${max}`);
  }
}

/** Encodes `image` as a non-interlaced PNG; each row gets its cheapest filter. */
export async function encodePng(image: PngImage): Promise<Uint8Array> {
  validateImage(image);
  const { width, height, channels, bitDepth, samples } = image;
  const bitsPerPixel = channels * bitDepth;
  const stride = rowBytes(width, bitsPerPixel);
  const bpp = filterDistance(bitsPerPixel);
  const samplesPerRow = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  let prior = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    row.fill(0);
    for (let i = 0; i < samplesPerRow; i++) {
      writeSample(row, i, bitDepth, samples[y * samplesPerRow + i]!);
    }
    let bestType = 0;
    let bestCost = Infinity;
    for (let type = 0; type < FILTER_TYPES; type++) {
      filterRow(type, row, prior, bpp, candidate);
      const cost = filterCost(candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
        best.set(candidate);
      }
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
    [prior, row] = [row, prior];
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([bitDepth, COLOR_TYPE_OF_CHANNELS[channels], 0, 0, 0], 8);
  return concat([
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', await transform(raw, new CompressionStream('deflate'))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

interface Chunk {
  type: string;
  data: Uint8Array;
  /** Offset of the next chunk. */
  end: number;
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaced: boolean;
}

function checkSignature(bytes: Uint8Array): void {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((value, i) => bytes[i] !== value)) {
    throw new PngError('Not a PNG file');
  }
}

/** Reads the chunk at `offset` and verifies its CRC. */
function readChunk(bytes: Uint8Array, offset: number): Chunk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (offset + 12 > bytes.length) {
    throw new PngError('PNG file is truncated');
  }
  const length = view.getUint32(offset);
  const end = offset + 12 + length;
  if (end > bytes.length) {
    throw new PngError('PNG file is truncated');
  }
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) {
    throw new PngError(`PNG chunk ${type} has a wrong CRC`);
  }
  return { type, data: bytes.subarray(offset + 8, end - 4), end };
}

/** The IHDR chunk, which the specification requires first. */
function readHeaderChunk(bytes: Uint8Array): Chunk {
  checkSignature(bytes);
  const first = readChunk(bytes, SIGNATURE.length);
  if (first.type !== 'IHDR' || first.data.length !== 13) {
    throw new PngError('PNG file does not start with an image header');
  }
  return first;
}

function parseHeader(data: Uint8Array): Header {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header = {
    width: view.getUint32(0),
    height: view.getUint32(4),
    bitDepth: data[8]!,
    colorType: data[9]!,
    interlaced: data[12] === 1,
  };
  if (header.width === 0 || header.height === 0) {
    throw new PngError(`PNG size ${header.width}x${header.height} is empty`);
  }
  if (!BIT_DEPTHS_OF_COLOR_TYPE[header.colorType]?.includes(header.bitDepth)) {
    throw new PngError(`PNG color type ${header.colorType} at ${header.bitDepth} bits is invalid`);
  }
  if (data[10] !== 0 || data[11] !== 0 || data[12]! > 1) {
    throw new PngError('PNG uses an unknown compression, filter or interlace method');
  }
  return header;
}

/** Image size from the header alone, without decoding the pixels. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const { width, height } = parseHeader(readHeaderChunk(bytes).data);
  return { width, height };
}

/** Chunks after IHDR up to IEND; ancillary chunks other than tRNS are dropped. */
function readBody(bytes: Uint8Array, offset: number): Chunk[] {
  const chunks: Chunk[] = [];
  let next = offset;
  let ended = false;
  while (!ended) {
    const current = readChunk(bytes, next);
    const critical = (current.type.charCodeAt(0) & 0x20) === 0;
    if (critical && !['PLTE', 'IDAT', 'IEND'].includes(current.type)) {
      throw new PngError(`PNG chunk ${current.type} is not supported`);
    }
    if (critical || current.type === 'tRNS') {
      chunks.push(current);
    }
    ended = current.type === 'IEND';
    next = current.end;
  }
  return chunks;
}

function passSize(pass: Pass, header: Header): { width: number; height: number } {
  return {
    width: Math.max(0, Math.ceil((header.width - pass.x0) / pass.dx)),
    height: Math.max(0, Math.ceil((header.height - pass.y0) / pass.dy)),
  };
}

/** Restores the filtered scanlines of all passes into samples, `channels` per pixel. */
function unpackScanlines(raw: Uint8Array, header: Header, channels: number): Uint16Array {
  const passes = header.interlaced ? ADAM7 : NON_INTERLACED;
  const bitsPerPixel = channels * header.bitDepth;
  const bpp = filterDistance(bitsPerPixel);
  const expected = passes.reduce((sum, pass) => {
    const size = passSize(pass, header);
    return sum + (size.width === 0 ? 0 : (rowBytes(size.width, bitsPerPixel) + 1) * size.height);
  }, 0);
  if (raw.length !== expected) {
    throw new PngError(`PNG image data has ${raw.length} bytes, expected ${expected}`);
  }
  const samples = new Uint16Array(header.width * header.height * channels);
  let offset = 0;
  for (const pass of passes) {
    const size = passSize(pass, header);
    const stride = rowBytes(size.width, bitsPerPixel);
    let prior: Uint8Array = new Uint8Array(stride);
    for (let y = 0; y < size.height && size.width > 0; y++) {
      const row = raw.subarray(offset + 1, offset + 1 + stride);
      unfilterRow(raw[offset]!, row, prior, bpp);
      const rowStart = (pass.y0 + y * pass.dy) * header.width;
      for (let x = 0; x < size.width; x++) {
        const pixel = (rowStart + pass.x0 + x * pass.dx) * channels;
        for (let c = 0; c < channels; c++) {
          samples[pixel + c] = readSample(row, x * channels + c, header.bitDepth);
        }
      }
      prior = row;
      offset += stride + 1;
    }
  }
  return samples;
}

/** Expands palette indices to 8-bit RGB, or RGBA when a tRNS chunk gives the palette alpha. */
function expandPalette(indices: Uint16Array, palette: Uint8Array | undefined, alpha: Uint8Array | undefined) {
  if (!palette || palette.length === 0 || palette.length % 3 !== 0) {
    throw new PngError('Palette PNG has no valid PLTE chunk');
  }
  const entries = palette.length / 3;
  const channels = alpha ? 4 : 3;
  const samples = new Uint16Array(indices.length * channels);
  indices.forEach((index, i) => {
    if (index >= entries) {
      throw new PngError(`PNG palette index ${index} exceeds the ${entries} palette entries`);
    }
    samples.set(palette.subarray(index * 3, index * 3 + 3), i * channels);
    if (alpha) {
      samples[i * channels + 3] = alpha[index] ?? 255;
    }
  });
  return { channels: channels as 3 | 4, samples };
}

/**
 * Decodes any standard PNG: all color types and bit depths, interlaced or not. Palette images become 8-bit
 * RGB(A); the transparent-color key of gray and RGB images is ignored like every other ancillary chunk.
 */
export async function decodePng(bytes: Uint8Array): Promise<PngImage> {
  const first = readHeaderChunk(bytes);
  const header = parseHeader(first.data);
  const chunks = readBody(bytes, first.end);
  const idat = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  if (idat.length === 0) {
    throw new PngError('PNG file has no image data');
  }
  const raw = await transform(concat(idat), new DecompressionStream('deflate')).catch((error: unknown) => {
    throw new PngError('PNG image data is corrupt', { cause: error });
  });
  const stored = CHANNELS_OF_COLOR_TYPE[header.colorType]!;
  const samples = unpackScanlines(raw, header, stored);
  const image =
    header.colorType === COLOR_PALETTE
      ? {
          ...expandPalette(
            samples,
            chunks.find((c) => c.type === 'PLTE')?.data,
            chunks.find((c) => c.type === 'tRNS')?.data,
          ),
          bitDepth: 8 as const,
        }
      : { channels: stored as PngImage['channels'], samples, bitDepth: header.bitDepth as PngImage['bitDepth'] };
  return { width: header.width, height: header.height, ...image };
}
