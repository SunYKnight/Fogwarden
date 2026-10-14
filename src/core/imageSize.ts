import { readPngSize } from './png';

type PixelSize = { widthPx: number; heightPx: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
// Frame (SOF) markers; C4, C8 and CC share the range but are not frames.
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// Bytes the WebP header and its first chunk need for any of the three layouts.
const WEBP_HEADER_BYTES = 30;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function jpegSize(bytes: Uint8Array, view: DataView): PixelSize | null {
  let size: PixelSize | null = null;
  let offset = 2;
  while (size === null && offset + 9 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]!;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      size = { widthPx: view.getUint16(offset + 7), heightPx: view.getUint16(offset + 5) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return size;
}

/** Lossy (VP8), lossless (VP8L) and extended (VP8X) WebP keep the size at different bit positions. */
function webpSize(bytes: Uint8Array, view: DataView): PixelSize | null {
  const chunk = ascii(bytes, 12, 4);
  let size: PixelSize | null = null;
  if (chunk === 'VP8 ') {
    size = { widthPx: view.getUint16(26, true) & 0x3fff, heightPx: view.getUint16(28, true) & 0x3fff };
  } else if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    size = { widthPx: (bits & 0x3fff) + 1, heightPx: ((bits >>> 14) & 0x3fff) + 1 };
  } else if (chunk === 'VP8X') {
    size = {
      widthPx: (view.getUint32(24, true) & 0xffffff) + 1,
      heightPx: (view.getUint32(26, true) >>> 8) + 1,
    };
  }
  return size;
}

/** Pixel size of a PNG, JPEG or WebP file from its header. */
export function imageSize(bytes: Uint8Array): PixelSize {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size: PixelSize | null = null;
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    const { width, height } = readPngSize(bytes);
    size = { widthPx: width, heightPx: height };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    size = jpegSize(bytes, view);
  } else if (bytes.length >= WEBP_HEADER_BYTES && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    size = webpSize(bytes, view);
  }
  if (size === null) {
    throw new Error('Unsupported image: expected PNG, JPEG or WebP');
  }
  return size;
}
