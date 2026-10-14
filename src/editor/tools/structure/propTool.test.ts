import { describe, expect, it } from 'vitest';
import { assertLoadableModel } from './propTool';

function gltf(document: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, ...document }));
}

describe('assertLoadableModel', () => {
  it('accepts models without required extensions', () => {
    expect(() => assertLoadableModel('crate.gltf', gltf({}))).not.toThrow();
    expect(() =>
      assertLoadableModel('crate.gltf', gltf({ extensionsRequired: ['KHR_mesh_quantization'] })),
    ).not.toThrow();
  });

  it('rejects models that need a decoder the loader lacks', () => {
    const draco = gltf({ extensionsRequired: ['KHR_draco_mesh_compression'] });
    expect(() => assertLoadableModel('rock.gltf', draco)).toThrow(/KHR_draco_mesh_compression/);
    const basis = gltf({ extensionsRequired: ['KHR_texture_basisu'] });
    expect(() => assertLoadableModel('rock.gltf', basis)).toThrow(/KHR_texture_basisu/);
  });
});
