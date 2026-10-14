/**
 * Stands in for `ndarray`, `ndarray-pixels` and `ndarray-lanczos`, which `@gltf-transform/functions` imports
 * only for texture resizing. Their dependency `ndarray-ops` compiles code with `Function()` on import, which
 * the app's Content Security Policy forbids, so the real packages would stop the DM window from starting.
 */
function unavailable(): never {
  throw new Error('Texture resizing is not available in Fogwarden');
}

export default unavailable;
export const getPixels = unavailable;
export const savePixels = unavailable;
export const lanczos2 = unavailable;
export const lanczos3 = unavailable;
