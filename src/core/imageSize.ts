const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
// Frame (SOF) markers; C4, C8 and CC share the range but are not frames.
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Pixel size of a PNG or JPEG file from its header. */
export function imageSize(bytes: Uint8Array): { widthPx: number; heightPx: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size: { widthPx: number; heightPx: number } | null = null;
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    size = { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (size === null && offset + 9 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!;
      if (JPEG_FRAME_MARKERS.has(marker)) {
        size = { widthPx: view.getUint16(offset + 7), heightPx: view.getUint16(offset + 5) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  if (size === null) {
    throw new Error('Unsupported image: expected PNG or JPEG');
  }
  return size;
}
