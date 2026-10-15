// Token pictures cover a few hundred pixels at most; full-size art would
// fill GPU memory with 30 different creatures on the map.
const MAX_TOKEN_TEXTURE_PX = 1024;

/** Longest edge of token pictures for the texture size setting: half of it, at most `MAX_TOKEN_TEXTURE_PX`. */
export function tokenTextureEdgePx(textureSizePx: number): number {
  return Math.min(MAX_TOKEN_TEXTURE_PX, textureSizePx / 2);
}

/** Graphics memory in MiB of a square RGBA texture `edgePx` long with its mipmaps. */
export function textureMemoryMiB(edgePx: number): number {
  // Mipmaps add a third to the base level.
  return (edgePx * edgePx * 4 * 4) / 3 / 2 ** 20;
}
