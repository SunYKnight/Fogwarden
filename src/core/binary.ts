// btoa takes binary strings; chunks keep fromCharCode under the arg limit.
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Lowercase hex, two digits per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Typed arrays use platform byte order; all targets are little-endian.
export function float32ToBase64(values: Float32Array): string {
  return bytesToBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

export function base64ToFloat32(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength % 4 !== 0) {
    throw new Error(`Float32 payload has ${bytes.byteLength} bytes, not a multiple of 4`);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/** Fixed-size bit array stored as bytes, used for fog of war cells. */
export class BitSet {
  readonly size: number;
  readonly bytes: Uint8Array;

  constructor(size: number, bytes?: Uint8Array) {
    const byteLength = Math.ceil(size / 8);
    if (bytes && bytes.length !== byteLength) {
      throw new Error(`BitSet of ${size} bits needs ${byteLength} bytes, got ${bytes.length}`);
    }
    this.size = size;
    this.bytes = bytes ?? new Uint8Array(byteLength);
  }

  static fromBase64(size: number, base64: string): BitSet {
    return new BitSet(size, base64.length === 0 ? undefined : base64ToBytes(base64));
  }

  get(index: number): boolean {
    return (this.bytes[index >> 3]! & (1 << (index & 7))) !== 0;
  }

  set(index: number, value: boolean): void {
    const mask = 1 << (index & 7);
    const byte = index >> 3;
    this.bytes[byte] = value ? this.bytes[byte]! | mask : this.bytes[byte]! & ~mask;
  }

  toBase64(): string {
    return bytesToBase64(this.bytes);
  }
}
