import { WebIO, type Document, type GLTF } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
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

/** A glTF JSON document; parsing checks only that it is one, loaders check the rest. */
export const gltfJsonSchema = z.custom<GLTF.IGLTF>(
  (value) => typeof value === 'object' && value !== null && 'asset' in value,
  'Not a glTF document',
);

/** One model of a set saved as several side by side, as its own glTF document. */
export interface GltfVariant {
  name: string;
  document: GLTF.IGLTF;
}

/**
 * Splits a document whose scene roots are variants of one model (a set of ferns laid out in a
 * row) into one document per root, each standing at the origin. Buffers and textures stay
 * shared; loaders read only what the scene uses.
 */
export function splitGltfVariants(document: GLTF.IGLTF): GltfVariant[] {
  const doc = documentSchema.parse(document);
  const nodes = document.nodes ?? [];
  return doc.scenes[doc.scene]!.nodes.map((root) => {
    const { translation: _offset, ...placed } = nodes[root]!;
    const name = doc.nodes[root]!.name.replace(/_LOD0$/, '').replace(/[^\w-]+/g, '_') || `variant-${root}`;
    const variantNodes = nodes.map((node, i) => (i === root ? placed : node));
    return { name, document: { ...document, scene: 0, scenes: [{ nodes: [root] }], nodes: variantNodes } };
  });
}

function triangleCount(doc: Document): number {
  const primitives = doc
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives());
  return primitives.reduce(
    (sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3,
    0,
  );
}

/** A variant's files: the `.gltf` text and the files it names (its `.bin`, shared textures). */
export interface VariantFiles {
  gltf: string;
  resources: Record<string, Uint8Array<ArrayBuffer>>;
}

/**
 * Keeps only what the variant's scene uses, in one buffer `<name>.bin`, and simplifies meshes
 * whose triangles exceed `budget` to about that many. `resources` holds the files the source
 * document names, by URI.
 */
export async function simplifyVariant(
  variant: GltfVariant,
  resources: Record<string, Uint8Array<ArrayBuffer>>,
  budget: number,
): Promise<VariantFiles> {
  // Poly Haven models use KHR_texture_transform and other extensions.
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readJSON({ json: variant.document, resources });
  await doc.transform(prune(), unpartition());
  const triangles = triangleCount(doc);
  if (triangles > budget) {
    await MeshoptSimplifier.ready;
    // An error bound of 2 % of the mesh size keeps leaf cards in place.
    const reduce = simplify({ simplifier: MeshoptSimplifier, ratio: budget / triangles, error: 0.02 });
    await doc.transform(dedup(), weld(), reduce, prune());
  }
  doc
    .getRoot()
    .listBuffers()
    .forEach((buffer) => buffer.setURI(`${variant.name}.bin`));
  const written = await io.writeJSON(doc);
  return { gltf: JSON.stringify(written.json), resources: written.resources };
}
