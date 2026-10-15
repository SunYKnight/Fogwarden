import { describe, expect, it } from 'vitest';
import { textureMemoryMiB, tokenTextureEdgePx } from './textureLimits';

describe('tokenTextureEdgePx', () => {
  it('keeps token pictures at 1024 px for the larger texture sizes', () => {
    expect(tokenTextureEdgePx(4096)).toBe(1024);
    expect(tokenTextureEdgePx(2048)).toBe(1024);
  });

  it('halves the smallest texture size', () => {
    expect(tokenTextureEdgePx(1024)).toBe(512);
  });
});

describe('textureMemoryMiB', () => {
  it('counts four bytes a pixel plus a third for mipmaps', () => {
    expect(textureMemoryMiB(4096)).toBeCloseTo(85.33, 2);
    expect(textureMemoryMiB(1024)).toBeCloseTo(5.33, 2);
  });
});
