import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { gltfJsonSchema, simplifyVariant } from './gltfDocument';

const counted = z.object({
  accessors: z.array(z.object({ count: z.number() })),
  meshes: z.array(z.object({ primitives: z.array(z.object({ indices: z.number() })) })),
});

// A flat 40 x 40 grid of quads (3200 triangles) with a texture, as a
// Poly Haven document names its files and uses its extensions.
function gridDocument() {
  const n = 41;
  const positions = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    positions.set([i % n, 0, Math.floor(i / n)], i * 3);
  }
  const indices: number[] = [];
  for (let z = 0; z < n - 1; z++) {
    for (let x = 0; x < n - 1; x++) {
      const a = z * n + x;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const index = new Uint16Array(indices);
  const bin = new Uint8Array(positions.byteLength + index.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(index.buffer), positions.byteLength);
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_texture_transform'],
    extensionsRequired: ['KHR_texture_transform'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'grid', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { scale: [2, 2] } } },
        },
      },
    ],
    textures: [{ source: 0 }],
    images: [{ uri: 'textures/grid_diff_1k.png', mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n * n, type: 'VEC3', min: [0, 0, 0], max: [40, 0, 40] },
      { bufferView: 1, componentType: 5123, count: index.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: index.byteLength },
    ],
    buffers: [{ uri: 'shared_8k.bin', byteLength: bin.byteLength }],
  };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { json: gltfJsonSchema.parse(json), resources: { 'shared_8k.bin': bin, 'textures/grid_diff_1k.png': png } };
}

function triangles(gltf: string): number {
  const { accessors, meshes } = counted.parse(JSON.parse(gltf));
  return meshes.flatMap((m) => m.primitives).reduce((sum, p) => sum + accessors[p.indices]!.count / 3, 0);
}

describe('simplifyVariant', () => {
  it('keeps a variant within budget as it is, in its own buffer, with the shared texture', async () => {
    const { json, resources } = gridDocument();
    const files = await simplifyVariant({ name: 'grid_a', document: json }, resources, 5000);
    expect(triangles(files.gltf)).toBe(3200);
    expect(Object.keys(files.resources).sort()).toEqual(['grid_a.bin', 'textures/grid_diff_1k.png']);
  });

  it('simplifies a variant over budget to about the budget', async () => {
    const { json, resources } = gridDocument();
    const files = await simplifyVariant({ name: 'grid_a', document: json }, resources, 400);
    // A flat grid loses nothing visible, so the simplifier reaches the target.
    expect(triangles(files.gltf)).toBeLessThanOrEqual(400);
    expect(triangles(files.gltf)).toBeGreaterThan(0);
  });
});
