import { describe, expect, it } from 'vitest';
import { gltfJsonSchema, gltfSize, splitGltfVariants } from './gltfDocument';

// Two ferns side by side, each a unit cube mesh; the second root is scaled
// and has a child offset upwards.
function fernSet() {
  return gltfJsonSchema.parse({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'fern_02_a_LOD0', mesh: 0 },
      { name: 'fern_02_b', mesh: 0, translation: [3, 0, 0], scale: [2, 2, 2], children: [2] },
      { name: 'tip', mesh: 0, translation: [0, 1, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }],
    buffers: [{ uri: 'fern_02.bin', byteLength: 36 }],
  });
}

describe('gltfSize', () => {
  it('measures the scene through node transforms without reading buffers', () => {
    // Root a spans x -0.5..0.5; root b (scale 2 at x 3) spans 2..4 and,
    // with its child one unit up in its own space, y 0..4.
    expect(gltfSize(fernSet())).toEqual({ x: 4.5, y: 4, z: 2 });
  });

  it('refuses out-of-range indices and node cycles', () => {
    expect(() => gltfSize({ ...fernSet(), meshes: [{ primitives: [{ attributes: { POSITION: 4 } }] }] })).toThrow(
      /accessor index/,
    );
    expect(() => gltfSize({ ...fernSet(), scenes: [{ nodes: [7] }] })).toThrow(/node index/);
    const cyclic = fernSet().nodes!.map((n, i) => (i === 2 ? { ...n, children: [1] } : n));
    expect(() => gltfSize({ ...fernSet(), nodes: cyclic })).toThrow(/own ancestor/);
  });
});

describe('splitGltfVariants', () => {
  it('makes one document per root, standing at the origin, sharing buffers', () => {
    const variants = splitGltfVariants(fernSet());
    expect(variants.map((v) => v.name)).toEqual(['fern_02_a', 'fern_02_b']);
    const b = variants[1]!.document;
    expect(b.scenes).toEqual([{ nodes: [1] }]);
    expect(gltfSize(b)).toEqual({ x: 2, y: 4, z: 2 });
    expect(b.buffers).toEqual(fernSet().buffers);
    // The original keeps its layout.
    expect(gltfSize(variants[0]!.document)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('drops the offset of a root placed by matrix', () => {
    const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 3, 0, 0, 1];
    const nodes = fernSet().nodes!.map((n, i) => (i === 1 ? { name: 'b', mesh: 0, matrix } : n));
    const b = splitGltfVariants({ ...fernSet(), nodes })[1]!.document;
    expect(b.nodes![1]!.matrix).toEqual([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
  });
});
