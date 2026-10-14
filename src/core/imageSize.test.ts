import { describe, expect, it } from 'vitest';
import { imageSize } from './imageSize';
import { encodePng } from './png';

function webp(chunk: string, body: number[]): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode(`RIFF\0\0\0\0WEBP${chunk}`));
  bytes.set(body, 20);
  return bytes;
}

describe('imageSize', () => {
  it('reads PNG headers', async () => {
    const png = await encodePng({ width: 3, height: 2, channels: 1, bitDepth: 8, samples: new Uint16Array(6) });
    expect(imageSize(png)).toEqual({ widthPx: 3, heightPx: 2 });
  });

  it('reads lossy, lossless and extended WebP headers', () => {
    // VP8: frame tag and start code, then 14-bit width 300 and height 200.
    expect(imageSize(webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x2c, 0x01, 0xc8, 0x00]))).toEqual({
      widthPx: 300,
      heightPx: 200,
    });
    // VP8L: signature 0x2f, then width-1 = 299 and height-1 = 199 in 14 bits each.
    const bits = 299 | (199 << 14);
    const vp8l = [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff];
    expect(imageSize(webp('VP8L', vp8l))).toEqual({ widthPx: 300, heightPx: 200 });
    // VP8X: flags, then 24-bit width-1 and height-1.
    expect(imageSize(webp('VP8X', [0, 0, 0, 0, 0x2b, 0x01, 0x00, 0xc7, 0x00, 0x00]))).toEqual({
      widthPx: 300,
      heightPx: 200,
    });
  });

  it('refuses unknown and truncated files with a clear error', () => {
    expect(() => imageSize(new Uint8Array([1, 2, 3]))).toThrow('Unsupported image');
    expect(() => imageSize(new TextEncoder().encode('RIFF\0\0\0\0WEBP'))).toThrow('Unsupported image');
  });
});
