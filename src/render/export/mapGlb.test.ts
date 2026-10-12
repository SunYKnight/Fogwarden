import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Mesh, MeshStandardMaterial, PropertyBinding, Texture, Vector3, type Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BattleMap, Prop, SideMaterial } from '@/core/model';
import { encodePng } from '@/core/png';
import { HeightField } from '@/core/terrain/heightfield';
import { Repository } from '@/data/repository';
import { CONTENT_ROOT, PROJECT_ROOT } from '../../../tools/cli';
import { NodeStorage } from '../../../tools/nodeStorage';
import { exportMapGlb, FEET_TO_METERS, type MapGlbSources } from './mapGlb';
import { SAMPLE_MAP } from '@/ui/home/sampleContent';

const scratchParent = join(PROJECT_ROOT, 'data-local');
mkdirSync(scratchParent, { recursive: true });
const scratch = mkdtempSync(join(scratchParent, 'glb-export-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The exporter reads its blobs with the browser's FileReader, which node lacks.
class BlobReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    }, console.error);
  }
}

beforeAll(() => {
  Object.assign(globalThis, { FileReader: globalThis.FileReader ?? BlobReader });
});

const SIDE_SHADES: Record<SideMaterial, number> = {
  projected: 255,
  stone: 120,
  brick: 140,
  wood: 100,
  plaster: 220,
  hedge: 60,
  rock: 110,
  metal: 150,
};

/** Re-imports a GLB in node, where pictures cannot be decoded: textures load as empty placeholders. */
function parseGlb(bytes: Uint8Array): Promise<GLTF> {
  const loader = new GLTFLoader().register(() => ({
    name: 'placeholder-textures',
    loadTexture: () => Promise.resolve(new Texture()),
  }));
  return loader.parseAsync(bytes.slice().buffer, '');
}

interface GlbJson {
  images: { mimeType: string }[];
  materials: { name: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  extensionsUsed?: string[];
}

/** The JSON chunk of a GLB file, which follows the 12-byte header and the chunk's 8-byte header. */
function glbJson(bytes: Uint8Array): GlbJson {
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

async function cubeModel(): Promise<Object3D> {
  const glb = await new GLTFExporter().parseAsync(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()), {
    binary: true,
  });
  return (await parseGlb(new Uint8Array(glb as ArrayBuffer))).scene;
}

function meshBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  root.traverse((child) => {
    if (child instanceof Mesh) box.expandByObject(child);
  });
  return box;
}

describe('exportMapGlb', () => {
  const repository = new Repository(new NodeStorage(scratch, CONTENT_ROOT));
  let map: BattleMap;
  let sources: MapGlbSources;

  beforeAll(async () => {
    map = await repository.load('map', SAMPLE_MAP);
    const { area, path } = map.image!.asset;
    sources = {
      battlemap: { bytes: await repository.storage.readBytes(area, path), mimeType: 'image/png' },
      sideImage: async (side) => ({
        bytes: await encodePng({
          width: 4,
          height: 4,
          channels: 1,
          bitDepth: 8,
          samples: new Uint16Array(16).fill(SIDE_SHADES[side]),
        }),
        mimeType: 'image/png',
      }),
      model: cubeModel,
    };
  });

  it('re-imports the sample map with its terrain, wall, door, window, roof and lights in meters', async () => {
    const terrain = HeightField.fromMap(map);
    const bytes = await exportMapGlb(map, terrain, sources, { lights: true });
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF');
    const json = glbJson(bytes);
    expect(json.extensionsUsed).toContain('KHR_lights_punctual');
    // Battlemap, rock skirt, stone wall, wooden door and roof.
    expect(json.images).toHaveLength(4);
    expect(json.images.every((i) => i.mimeType === 'image/png')).toBe(true);
    const textured = json.materials.filter((m) => m.pbrMetallicRoughness?.baseColorTexture).map((m) => m.name);
    expect(textured.sort()).toEqual(['Battlemap', 'Battlemap (both sides)', 'Side rock', 'Side stone', 'Side wood']);

    const { scene } = await parseGlb(bytes);
    const root = scene.getObjectByName(PropertyBinding.sanitizeNodeName(map.name))!;
    expect(root.scale.toArray()).toEqual([FEET_TO_METERS, FEET_TO_METERS, FEET_TO_METERS]);
    expect(root.children.map((c) => c.name)).toEqual(
      ['Terrain', 'Wall', 'window', 'door', 'Chapel nave roof', 'Altar torch', 'Campfire'].map((name) =>
        PropertyBinding.sanitizeNodeName(name),
      ),
    );
    const meshes: Mesh[] = [];
    scene.traverse((child) => {
      if (child instanceof Mesh) meshes.push(child);
    });
    expect(meshes.length).toBeGreaterThanOrEqual(5);
    expect(root.children.slice(-2).filter((l) => 'isPointLight' in l)).toHaveLength(2);
    const bounds = meshBounds(scene);
    const widthM = map.grid.squaresX * map.grid.feetPerSquare * FEET_TO_METERS;
    const depthM = map.grid.squaresY * map.grid.feetPerSquare * FEET_TO_METERS;
    let lowest = Infinity;
    terrain.data.forEach((h) => (lowest = Math.min(lowest, h)));
    expect(bounds.min.x).toBeCloseTo(0, 3);
    expect(bounds.min.z).toBeCloseTo(0, 3);
    expect(bounds.max.x).toBeCloseTo(widthM, 3);
    expect(bounds.max.z).toBeCloseTo(depthM, 3);
    // Skirt: 3 ft below the lowest ground; the roof sits on 12 ft walls.
    expect(bounds.min.y).toBeCloseTo((lowest - 3) * FEET_TO_METERS, 3);
    expect(bounds.max.y).toBeGreaterThan(12 * FEET_TO_METERS);
    expect(bounds.max.y).toBeLessThan(20 * FEET_TO_METERS);
  });

  it('places props at their size in meters, with and without the battlemap projected onto them', async () => {
    const terrain = HeightField.fromMap(map);
    const metersToFeet = 1 / FEET_TO_METERS;
    const prop = (id: string, x: number, projectMap: boolean): Prop => ({
      id,
      name: id,
      asset: { area: 'content', path: 'cube.glb' },
      position: [x, 0.5 * metersToFeet, 40],
      rotationDeg: [0, 45, 0],
      scale: [metersToFeet, metersToFeet, metersToFeet],
      projectMap,
      occludesSight: false,
      blocksMovement: false,
      walkable: false,
    });
    const withProps = { ...map, props: [prop('Crate', 20, false), prop('Rock', 80, true)] };
    const { scene } = await parseGlb(await exportMapGlb(withProps, terrain, sources, { lights: false }));
    for (const [name, x] of [
      ['Crate', 20],
      ['Rock', 80],
    ] as const) {
      const box = meshBounds(scene.getObjectByName(name)!);
      const size = box.getSize(new Vector3());
      // A unit cube turned 45 degrees spans the square's diagonal.
      expect(size.x).toBeCloseTo(Math.SQRT2, 3);
      expect(size.y).toBeCloseTo(1, 3);
      expect(box.getCenter(new Vector3()).x).toBeCloseTo(x * FEET_TO_METERS, 3);
      expect(box.min.y).toBeCloseTo(0, 3);
    }
    const rock = scene.getObjectByName('Rock')!;
    const materials: string[] = [];
    rock.traverse((child) => {
      if (child instanceof Mesh) materials.push(...[child.material].flat().map((m: { name: string }) => m.name));
    });
    expect(materials).toContain('Battlemap');
  });
});
