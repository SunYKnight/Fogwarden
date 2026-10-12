import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BYTES_PER_PIXEL = 3;
const COLOR_TYPE_RGB = 2;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, 'latin1'), 4);
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

/** The five PNG row filters applied to `row` with `prior` as the row above. */
function filterRow(type: number, row: Uint8Array, prior: Uint8Array, out: Uint8Array): void {
  for (let i = 0; i < row.length; i++) {
    const a = i >= BYTES_PER_PIXEL ? row[i - BYTES_PER_PIXEL]! : 0;
    const c = i >= BYTES_PER_PIXEL ? prior[i - BYTES_PER_PIXEL]! : 0;
    out[i] = (row[i]! - predictor(type, a, prior[i]!, c)) & 0xff;
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

/** Encodes 8-bit RGB pixels (row-major, no padding) as a PNG file; each row gets its cheapest filter. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * BYTES_PER_PIXEL;
  if (rgb.length !== stride * height) {
    throw new Error(`Expected ${stride * height} bytes for ${width}x${height} RGB, got ${rgb.length}`);
  }
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  let prior: Uint8Array = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestCost = Infinity;
    for (let type = 0; type < 5; type++) {
      filterRow(type, row, prior, candidate);
      const cost = filterCost(candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
        best.set(candidate);
      }
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
    prior = row;
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, COLOR_TYPE_RGB, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  return Buffer.concat(parts);
}
