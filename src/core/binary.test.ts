import { describe, expect, it } from 'vitest';
import { base64ToFloat32, BitSet, bytesToBase64, crc32, float32ToBase64, inflate } from './binary';

async function deflated(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
  );
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('inflate', () => {
  it('inflates within the limit and stops a stream that expands past it', async () => {
    const zeros = new Uint8Array(1 << 16);
    const packed = await deflated(zeros);
    const inflated = await inflate(packed, 'deflate-raw', zeros.length);
    expect(inflated.length === zeros.length && inflated.every((b) => b === 0)).toBe(true);
    await expect(inflate(packed, 'deflate-raw', 1000)).rejects.toThrow('inflates past 1000 bytes');
  });
});

describe('BitSet', () => {
  it('keeps neighbouring bits independent across byte boundaries', () => {
    const bits = new BitSet(20);
    bits.set(7, true);
    bits.set(8, true);
    bits.set(19, true);
    bits.set(8, false);
    expect([6, 7, 8, 9, 19].map((i) => bits.get(i))).toEqual([false, true, false, false, true]);
  });

  it('round-trips through base64 and treats an empty string as all clear', () => {
    const bits = new BitSet(13);
    bits.set(0, true);
    bits.set(12, true);
    const restored = BitSet.fromBase64(13, bits.toBase64());
    expect(restored.get(0) && restored.get(12) && !restored.get(5)).toBe(true);
    expect(BitSet.fromBase64(13, '').get(12)).toBe(false);
  });

  it('rejects stored data of the wrong size', () => {
    expect(() => BitSet.fromBase64(64, bytesToBase64(new Uint8Array(3)))).toThrow(/needs 8 bytes/);
  });
});

describe('float32 base64', () => {
  it('round-trips heights including negative and fractional values', () => {
    const values = new Float32Array([0, -12.5, 3.25, 1e6]);
    expect([...base64ToFloat32(float32ToBase64(values))]).toEqual([...values]);
  });

  it('round-trips arrays larger than one encoding chunk', () => {
    const values = new Float32Array(50_000).map((_, i) => i * 0.5);
    expect(base64ToFloat32(float32ToBase64(values))[49_999]).toBe(24_999.5);
  });

  it('rejects payloads that are not whole floats', () => {
    expect(() => base64ToFloat32(bytesToBase64(new Uint8Array(6)))).toThrow(/multiple of 4/);
  });
});
