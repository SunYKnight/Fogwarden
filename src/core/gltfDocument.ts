import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { z } from 'zod';
import type { Size3 } from './import/damCatalog';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const nodeSchema = z.object({
  name: z.string().default(''),
  mesh: z.number().int().optional(),
  children: z.array(z.number().int()).default([]),
  matrix: z.array(z.number()).length(16).optional(),
  translation: vec3.optional(),
  rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  scale: vec3.optional(),
});
const documentSchema = z.object({
  scene: z.number().int().default(0),
  scenes: z.array(z.object({ nodes: z.array(z.number().int()).default([]) })).min(1),
  nodes: z.array(nodeSchema).default([]),
  meshes: z
    .array(z.object({ primitives: z.array(z.object({ attributes: z.object({ POSITION: z.number().int() }) })) }))
    .default([]),
  accessors: z.array(z.object({ min: z.array(z.number()).optional(), max: z.array(z.number()).optional() })),
});

function localMatrix(node: z.infer<typeof nodeSchema>): Matrix4 {
  const { matrix, translation = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1] } = node;
  return matrix
    ? new Matrix4().fromArray(matrix)
    : new Matrix4().compose(new Vector3(...translation), new Quaternion(...rotation), new Vector3(...scale));
}

/**
 * Size of the default scene in model units, from the accessor bounds glTF requires on
 * positions; no buffers or textures are read.
 */
export function gltfSize(document: unknown): Size3 {
  const doc = documentSchema.parse(document);
  const box = new Box3();
  const visit = (index: number, parent: Matrix4) => {
    const node = doc.nodes[index]!;
    const world = parent.clone().multiply(localMatrix(node));
    const primitives = node.mesh === undefined ? [] : doc.meshes[node.mesh]!.primitives;
    for (const { attributes } of primitives) {
      const { min, max } = doc.accessors[attributes.POSITION]!;
      if (min && max) {
        box.union(new Box3(new Vector3(...min), new Vector3(...max)).applyMatrix4(world));
      }
    }
    node.children.forEach((child) => visit(child, world));
  };
  doc.scenes[doc.scene]!.nodes.forEach((root) => visit(root, new Matrix4()));
  const size = box.isEmpty() ? new Vector3() : box.getSize(new Vector3());
  return { x: size.x, y: size.y, z: size.z };
}

/** One model of a set saved as several side by side, as its own glTF document. */
export interface GltfVariant {
  name: string;
  document: Record<string, unknown>;
}

/**
 * Splits a document whose scene roots are variants of one model (a set of ferns laid out in a
 * row) into one document per root, each standing at the origin. Buffers and textures stay
 * shared; loaders read only what the scene uses.
 */
export function splitGltfVariants(document: Record<string, unknown>): GltfVariant[] {
  const doc = documentSchema.parse(document);
  const nodes = z.array(z.record(z.string(), z.unknown())).parse(document.nodes);
  return doc.scenes[doc.scene]!.nodes.map((root) => {
    const { translation: _offset, ...placed } = nodes[root]!;
    const name = doc.nodes[root]!.name.replace(/_LOD0$/, '').replace(/[^\w-]+/g, '_') || `variant-${root}`;
    const variantNodes = nodes.map((node, i) => (i === root ? placed : node));
    return { name, document: { ...document, scene: 0, scenes: [{ nodes: [root] }], nodes: variantNodes } };
  });
}
