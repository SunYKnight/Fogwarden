import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { GLTFExporter, type GLTFExporterPlugin, type GLTFWriter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { AssetRef, BattleMap, Opening, SideMaterial } from '@/core/model';
import { wallCorners } from '@/core/geometry/wallOutline';
import { wallPieces, type WallPiece } from '@/core/geometry/walls';
import type { HeightField } from '@/core/terrain/heightfield';
import { GLASS, IRON, openingFillSide, openingFrame, WALL_SIDE_SLOPE_DEG } from '../structures/openingShape';
import { roomFloorGeometry, roomRoofGeometry } from '../structures/roomGeometry';
import { buildWallGeometry } from '../structures/wallGeometry';
import { createTerrainGeometry } from '../terrain/terrainGeometry';

export const FEET_TO_METERS = 0.3048;
// One repeat of a side texture covers 5 ft, as in the projected material.
const SIDE_TILE_FT = 5;
// Roofs show their material on every face, flat ones included.
const ALL_SIDE_COS = 2;
// Exported point lights light their full reach to about this many lux.
const LUX_AT_REACH = 25;
const DEG = Math.PI / 180;
const WALL_SIDE_COS = Math.cos(WALL_SIDE_SLOPE_DEG * DEG);
const UP = new Vector3(0, 1, 0);
const GL_LINEAR = 9729;
const GL_LINEAR_MIPMAP_LINEAR = 9987;
const GL_REPEAT = 10497;
const GL_CLAMP_TO_EDGE = 33071;

export interface EncodedImage {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
}

/** Pictures and models the export embeds; the app decodes and encodes them, tests pass files. */
export interface MapGlbSources {
  /** The battlemap seen from above, covering exactly the map's squares from its north-west corner. */
  battlemap: EncodedImage;
  sideImage(material: SideMaterial): Promise<EncodedImage>;
  /** A fresh copy of a prop's glTF scene. */
  model(asset: AssetRef): Promise<Object3D>;
}

export interface MapGlbOptions {
  /** Map lights as KHR_lights_punctual point lights. */
  lights: boolean;
}

interface SurfaceImage {
  image: EncodedImage;
  repeat: boolean;
}

/** Materials of one export: the battlemap on top faces, side textures on steep faces. */
class SurfaceMaterials {
  readonly images = new Map<Material, SurfaceImage>();
  private readonly battlemapImage: SurfaceImage;
  private readonly battlemaps = new Map<boolean, MeshStandardMaterial>();
  private readonly sides = new Map<SideMaterial, Promise<MeshStandardMaterial>>();

  constructor(private readonly sources: MapGlbSources) {
    this.battlemapImage = { image: sources.battlemap, repeat: false };
  }

  battlemap(doubleSided: boolean): MeshStandardMaterial {
    let material = this.battlemaps.get(doubleSided);
    if (!material) {
      material = new MeshStandardMaterial({
        name: doubleSided ? 'Battlemap (both sides)' : 'Battlemap',
        roughness: 0.95,
        metalness: 0,
        side: doubleSided ? DoubleSide : FrontSide,
      });
      this.images.set(material, this.battlemapImage);
      this.battlemaps.set(doubleSided, material);
    }
    return material;
  }

  side(side: SideMaterial): Promise<MeshStandardMaterial> {
    let material = this.sides.get(side);
    if (!material) {
      material = this.sources.sideImage(side).then((image) => {
        const created = new MeshStandardMaterial({ name: `Side ${side}`, roughness: 0.95, metalness: 0 });
        this.images.set(created, { image, repeat: true });
        return created;
      });
      this.sides.set(side, material);
    }
    return material;
  }
}

interface Surface {
  name: string;
  /** World feet, with normals. */
  geometry: BufferGeometry;
  /** Faces less upright than this cosine use the side material. */
  sideCos: number;
  /** Null: the battlemap on every face, as the projected material without a side texture. */
  side: SideMaterial | null;
  doubleSided?: boolean;
}

/**
 * One mesh like the projected material draws it: top faces get the battlemap by their map position,
 * steeper faces the side texture tiled along their dominant axis. Steep faces get their own vertices,
 * as their texture coordinates differ.
 */
async function surfaceMesh(surface: Surface, map: BattleMap, materials: SurfaceMaterials): Promise<Mesh> {
  const { geometry, sideCos, side } = surface;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const source = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: position.count }, (_, i) => i);
  const widthFt = map.grid.squaresX * map.grid.feetPerSquare;
  const heightFt = map.grid.squaresY * map.grid.feetPerSquare;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const shared = new Map<number, number>();
  const add = (i: number, u: number, v: number) => {
    positions.push(position.getX(i), position.getY(i), position.getZ(i));
    normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  const top: number[] = [];
  const steep: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t + 2 < source.length; t += 3) {
    const corners = [source[t]!, source[t + 1]!, source[t + 2]!];
    a.fromBufferAttribute(position, corners[0]!);
    b.fromBufferAttribute(position, corners[1]!);
    c.fromBufferAttribute(position, corners[2]!);
    const n = c.sub(b).cross(a.sub(b)).normalize();
    const isSteep = side !== null && Math.abs(n.y) < sideCos;
    if (isSteep) {
      const [ax, ay, az] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
      const axis = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
      for (const i of corners) {
        const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
        const [u, v] = axis === 'x' ? [z, -y] : axis === 'y' ? [x, z] : [x, -y];
        steep.push(add(i, u / SIDE_TILE_FT, v / SIDE_TILE_FT));
      }
    } else {
      for (const i of corners) {
        const known = shared.get(i) ?? add(i, position.getX(i) / widthFt, position.getZ(i) / heightFt);
        shared.set(i, known);
        top.push(known);
      }
    }
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  result.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  result.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  result.setIndex(new BufferAttribute(new Uint32Array([...top, ...steep]), 1));
  const battlemap = materials.battlemap(surface.doubleSided ?? false);
  const sideMaterial = side === null || steep.length === 0 ? null : await materials.side(side);
  if (sideMaterial) {
    result.addGroup(0, top.length, 0);
    result.addGroup(top.length, steep.length, 1);
  }
  const mesh = new Mesh(result, sideMaterial ? [battlemap, sideMaterial] : battlemap);
  mesh.name = surface.name;
  return mesh;
}

/** Projected props carry the battlemap; their meshes are baked into map space for that. */
function bakedMeshes(model: Object3D): BufferGeometry[] {
  model.updateMatrixWorld(true);
  const geometries: BufferGeometry[] = [];
  model.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = (child.geometry as BufferGeometry).clone().applyMatrix4(child.matrixWorld);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      geometries.push(geometry);
    }
  });
  return geometries;
}

/** A closed door, pane or set of bars as the structure layer draws it, baked into map space. */
async function openingObject(
  map: BattleMap,
  terrain: HeightField,
  piece: WallPiece & { opening: Opening },
  materials: SurfaceMaterials,
): Promise<Group> {
  const { wall, opening } = piece;
  const { position, rotationY, shape } = openingFrame(wall, piece, opening, false, terrain);
  const frame = new Matrix4()
    .compose(new Vector3(...position), new Quaternion().setFromAxisAngle(UP, rotationY), new Vector3(1, 1, 1))
    .multiply(
      new Matrix4().compose(
        new Vector3(...shape.position),
        new Quaternion().setFromAxisAngle(UP, shape.rotationY),
        new Vector3(...shape.scale),
      ),
    );
  const fill = openingFillSide(opening, wall);
  const group = new Group();
  group.name = opening.kind;
  // Arrow slits are only a pick box in the editor; nothing is drawn.
  for (const part of shape.parts.filter((p) => p.material !== 'hit')) {
    const local = new Matrix4().compose(new Vector3(...part.position), new Quaternion(), new Vector3(...part.scale));
    const geometry = new BoxGeometry(1, 1, 1).applyMatrix4(frame.clone().multiply(local));
    const side = fill === 'projected' ? null : fill;
    group.add(
      part.material === 'fill'
        ? await surfaceMesh({ name: opening.kind, geometry, sideCos: WALL_SIDE_COS, side }, map, materials)
        : new Mesh(geometry, part.material === 'glass' ? GLASS : IRON),
    );
  }
  return group;
}

async function wallObjects(map: BattleMap, terrain: HeightField, materials: SurfaceMaterials): Promise<Object3D[]> {
  const objects: Object3D[] = [];
  for (const wall of map.walls) {
    const pieces = wallPieces({ walls: [wall], openings: map.openings });
    const geometry = buildWallGeometry(wall, wallCorners(wall, map.walls), pieces, new Set(), terrain);
    const side = wall.material === 'projected' ? null : wall.material;
    objects.push(await surfaceMesh({ name: 'Wall', geometry, sideCos: WALL_SIDE_COS, side }, map, materials));
    const filled = pieces.filter((p): p is WallPiece & { opening: Opening } => p.opening !== null);
    for (const piece of filled) {
      const group = await openingObject(map, terrain, piece, materials);
      objects.push(...(group.children.length > 0 ? [group] : []));
    }
  }
  return objects;
}

async function roomObjects(map: BattleMap, terrain: HeightField, materials: SurfaceMaterials): Promise<Object3D[]> {
  const { cliffMaterial, cliffSlopeDeg } = map.terrain;
  const cliff = cliffMaterial === 'projected' ? null : cliffMaterial;
  const objects: Object3D[] = [];
  for (const room of map.rooms) {
    const name = room.name || 'Room';
    if (room.floorFt !== null) {
      const geometry = roomFloorGeometry(room, terrain);
      const floor = { name: `${name} floor`, geometry, sideCos: Math.cos(cliffSlopeDeg * DEG), side: cliff };
      objects.push(await surfaceMesh(floor, map, materials));
    }
    if (room.roof) {
      const side = room.roofMaterial === 'projected' ? null : room.roofMaterial;
      const geometry = roomRoofGeometry(room, terrain);
      objects.push(await surfaceMesh({ name: `${name} roof`, geometry, sideCos: ALL_SIDE_COS, side }, map, materials));
    }
  }
  return objects;
}

async function propObjects(map: BattleMap, sources: MapGlbSources, materials: SurfaceMaterials): Promise<Object3D[]> {
  const { cliffMaterial, cliffSlopeDeg } = map.terrain;
  const objects: Object3D[] = [];
  for (const prop of map.props) {
    const group = new Group();
    group.name = prop.name;
    group.position.set(...prop.position);
    group.rotation.set(prop.rotationDeg[0] * DEG, prop.rotationDeg[1] * DEG, prop.rotationDeg[2] * DEG);
    group.scale.set(...prop.scale);
    group.add(await sources.model(prop.asset));
    const side = cliffMaterial === 'projected' ? null : cliffMaterial;
    const sideCos = Math.cos(cliffSlopeDeg * DEG);
    const projected = new Group();
    projected.name = prop.name;
    for (const geometry of prop.projectMap ? bakedMeshes(group) : []) {
      projected.add(await surfaceMesh({ name: prop.name, geometry, sideCos, side }, map, materials));
    }
    objects.push(prop.projectMap ? projected : group);
  }
  return objects;
}

function lightObjects(map: BattleMap): Object3D[] {
  return map.lights
    .filter((l) => l.enabled)
    .map((l) => {
      const reachM = Math.max(1, l.brightFt + l.dimFt) * FEET_TO_METERS;
      // glTF light range and intensity ignore node scale: meters and candela.
      const light = new PointLight(l.color, LUX_AT_REACH * reachM * reachM, reachM, 2);
      light.name = l.name;
      light.position.set(l.position.x, l.position.elevationFt, l.position.y);
      return light;
    });
}

/**
 * The map as the editor shows it, built from the render code's geometry: terrain with the battlemap,
 * walls with their materials, doors, windows and bars closed, room floors and roofs, props, and
 * optionally the lights. Built in feet under one root scaled to meters.
 */
export async function buildMapScene(
  map: BattleMap,
  terrain: HeightField,
  sources: MapGlbSources,
  options: MapGlbOptions,
): Promise<{ root: Group; images: Map<Material, SurfaceImage> }> {
  const materials = new SurfaceMaterials(sources);
  const { cliffMaterial, cliffSlopeDeg } = map.terrain;
  const ground = await surfaceMesh(
    {
      name: 'Terrain',
      geometry: createTerrainGeometry(terrain),
      sideCos: Math.cos(cliffSlopeDeg * DEG),
      side: cliffMaterial === 'projected' ? null : cliffMaterial,
      doubleSided: true,
    },
    map,
    materials,
  );
  const root = new Group();
  root.name = map.name;
  root.scale.setScalar(FEET_TO_METERS);
  root.add(
    ground,
    ...(await wallObjects(map, terrain, materials)),
    ...(await roomObjects(map, terrain, materials)),
    ...(await propObjects(map, sources, materials)),
    ...(options.lights ? lightObjects(map) : []),
  );
  return { root, images: materials.images };
}

/** The exporter's writer as far as plugins that add images use it. */
interface ImageWriter {
  json: { images?: object[]; samplers?: object[]; textures?: object[] };
  processBufferViewImage(blob: Blob): Promise<number>;
}

/** Embeds the already encoded pictures as base color textures, so no canvas re-encodes them. */
function embeddedImages(images: Map<Material, SurfaceImage>) {
  return (writer: GLTFWriter): GLTFExporterPlugin => {
    const internals = writer as unknown as ImageWriter;
    const textures = new Map<SurfaceImage, Promise<number>>();
    const texture = async ({ image, repeat }: SurfaceImage) => {
      const bufferView = await internals.processBufferViewImage(new Blob([new Uint8Array(image.bytes)]));
      const json = internals.json;
      json.images ??= [];
      json.samplers ??= [];
      json.textures ??= [];
      const source = json.images.push({ mimeType: image.mimeType, bufferView }) - 1;
      const wrap = repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE;
      const sampler =
        json.samplers.push({ magFilter: GL_LINEAR, minFilter: GL_LINEAR_MIPMAP_LINEAR, wrapS: wrap, wrapT: wrap }) - 1;
      return json.textures.push({ source, sampler }) - 1;
    };
    return {
      writeMaterialAsync: async (material, materialDef) => {
        const surface = images.get(material);
        if (surface) {
          const index = textures.get(surface) ?? texture(surface);
          textures.set(surface, index);
          const pbr = (materialDef.pbrMetallicRoughness ?? {}) as Record<string, unknown>;
          pbr.baseColorTexture = { index: await index };
          materialDef.pbrMetallicRoughness = pbr;
        }
      },
    };
  };
}

/** Binary glTF of the map in meters (see `buildMapScene`); opens in Blender and other 3D tools. */
export async function exportMapGlb(
  map: BattleMap,
  terrain: HeightField,
  sources: MapGlbSources,
  options: MapGlbOptions,
): Promise<Uint8Array> {
  const { root, images } = await buildMapScene(map, terrain, sources, options);
  const exporter = new GLTFExporter().register(embeddedImages(images));
  const result = await exporter.parseAsync(root, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('The glTF exporter returned JSON instead of a binary file');
  }
  return new Uint8Array(result);
}
