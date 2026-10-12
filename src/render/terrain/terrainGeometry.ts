import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, type MeshBVH } from 'three-mesh-bvh';
import type { Vec2 } from '@/core/model';
import type { SampleRect } from '@/core/terrain/brushes';
import type { HeightField } from '@/core/terrain/heightfield';

// BVH raycasts: tools hit-test the terrain on every pointer move.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

/** Depth of the vertical skirt around the terrain below its lowest point. */
const SKIRT_FT = 3;

interface TerrainLayout {
  border: number[];
  surfaceCount: number;
}

/** Clockwise (seen from above) list of surface vertex indices along the field border. */
function borderRing(cols: number, rows: number): number[] {
  const ring: number[] = [];
  for (let c = 0; c < cols - 1; c++) ring.push(c);
  for (let r = 0; r < rows - 1; r++) ring.push(r * cols + cols - 1);
  for (let c = cols - 1; c > 0; c--) ring.push((rows - 1) * cols + c);
  for (let r = rows - 1; r > 0; r--) ring.push(r * cols);
  return ring;
}

/**
 * Surface grid of the height field plus a skirt along the border, so the map reads as a solid block.
 * Vertex order: surface (cols*rows), skirt top ring, skirt bottom ring. The skirt has its own top
 * vertices so its normals stay horizontal and the shader renders it with the side material.
 */
export function createTerrainGeometry(field: HeightField): BufferGeometry {
  const { cols, rows } = field;
  const border = borderRing(cols, rows);
  const ring = border.length;
  const surfaceCount = cols * rows;
  const positions = new Float32Array((surfaceCount + ring * 2) * 3);
  const indices = new Uint32Array(((cols - 1) * (rows - 1) * 2 + ring * 2) * 3);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      indices.set([a, a + cols, a + 1, a + 1, a + cols, a + cols + 1], k);
      k += 6;
    }
  }
  for (let i = 0; i < ring; i++) {
    const next = (i + 1) % ring;
    const top0 = surfaceCount + i;
    const top1 = surfaceCount + next;
    const bottom0 = surfaceCount + ring + i;
    const bottom1 = surfaceCount + ring + next;
    indices.set([top0, top1, bottom0, top1, bottom1, bottom0], k);
    k += 6;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  const layout: TerrainLayout = { border, surfaceCount };
  geometry.userData.terrainLayout = layout;
  updateTerrainGeometry(geometry, field);
  geometry.computeBoundsTree();
  return geometry;
}

/** Writes current heights into a geometry created for a field of the same size. */
export function updateTerrainGeometry(geometry: BufferGeometry, field: HeightField): void {
  const { cols, rows, spacingFt, data } = field;
  const { border, surfaceCount } = geometry.userData.terrainLayout as TerrainLayout;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const array = position.array as Float32Array;
  let min = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const h = data[i]!;
      min = Math.min(min, h);
      array[i * 3] = c * spacingFt;
      array[i * 3 + 1] = h;
      array[i * 3 + 2] = r * spacingFt;
    }
  }
  border.forEach((top, i) => {
    const t = (surfaceCount + i) * 3;
    const b = (surfaceCount + border.length + i) * 3;
    array[t] = array[b] = array[top * 3]!;
    array[t + 1] = array[top * 3 + 1]!;
    array[b + 1] = min - SKIRT_FT;
    array[t + 2] = array[b + 2] = array[top * 3 + 2]!;
  });
  // A pending partial upload would otherwise hide this full rewrite.
  position.clearUpdateRanges();
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  (geometry.getAttribute('normal') as BufferAttribute).clearUpdateRanges();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  (geometry.boundsTree as MeshBVH | undefined)?.refit();
}

// Reused between sculpt dabs; grows to the largest brush window seen.
let normalScratch = new Float32Array(0);

/**
 * Recomputes surface normals for the vertices in `region` like `computeVertexNormals` (sum of the
 * area-weighted face normals around each vertex), visiting only the cells around the region. On the
 * regular grid the face cross products reduce to height differences times the spacing.
 */
function updateSurfaceNormals(field: HeightField, normals: Float32Array, region: SampleRect): void {
  const { cols, rows, spacingFt: s, data } = field;
  const c0 = Math.max(0, region.c0 - 1);
  const r0 = Math.max(0, region.r0 - 1);
  const c1 = Math.min(cols - 2, region.c1);
  const r1 = Math.min(rows - 2, region.r1);
  const width = c1 - c0 + 2;
  const size = width * (r1 - r0 + 2) * 3;
  if (normalScratch.length < size) {
    normalScratch = new Float32Array(size);
  }
  const sum = normalScratch;
  sum.fill(0, 0, size);
  const up = s * s;
  const add = (i: number, x: number, y: number, z: number) => {
    sum[i] = sum[i]! + x;
    sum[i + 1] = sum[i + 1]! + y;
    sum[i + 2] = sum[i + 2]! + z;
  };
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const a = r * cols + c;
      const hA = data[a]!;
      const hB = data[a + cols]!;
      const hC = data[a + 1]!;
      const hD = data[a + cols + 1]!;
      const la = ((r - r0) * width + (c - c0)) * 3;
      const lb = la + width * 3;
      // Faces (a, a+cols, a+1), (a+1, a+cols, a+cols+1) as indexed.
      const x1 = s * (hA - hC);
      const z1 = s * (hA - hB);
      const x2 = s * (hB - hD);
      const z2 = s * (hC - hD);
      add(la, x1, up, z1);
      add(lb, x1 + x2, 2 * up, z1 + z2);
      add(la + 3, x1 + x2, 2 * up, z1 + z2);
      add(lb + 3, x2, up, z2);
    }
  }
  for (let r = region.r0; r <= region.r1; r++) {
    for (let c = region.c0; c <= region.c1; c++) {
      const l = ((r - r0) * width + (c - c0)) * 3;
      const i = (r * cols + c) * 3;
      const length = Math.hypot(sum[l]!, sum[l + 1]!, sum[l + 2]!);
      normals[i] = sum[l]! / length;
      normals[i + 1] = sum[l + 1]! / length;
      normals[i + 2] = sum[l + 2]! / length;
    }
  }
}

/**
 * Refits only the BVH nodes overlapping the map plane box, plus the nodes on the map border when the
 * skirt moved; heights never move vertices sideways, so plane bounds pick the nodes reliably.
 */
function refitRegion(bvh: MeshBVH, field: HeightField, min: Vec2, max: Vec2, skirtMoved: boolean): void {
  const nodes = new Set<number>();
  const eps = 1e-3;
  bvh.shapecast({
    intersectsBounds: (box, _isLeaf, _score, _depth, nodeIndex) => {
      const inBox = box.min.x <= max.x && box.max.x >= min.x && box.min.z <= max.y && box.max.z >= min.y;
      const onBorder =
        box.min.x <= eps || box.min.z <= eps || box.max.x >= field.widthFt - eps || box.max.z >= field.depthFt - eps;
      const hit = inBox || (skirtMoved && onBorder);
      if (hit) nodes.add(nodeIndex);
      return hit;
    },
    intersectsRange: () => false,
  });
  bvh.refit(nodes);
}

/**
 * Writes the heights in `rect` only: positions, the normals that depend on them, the skirt, bounds and
 * the BVH nodes over the region. A full update of a 100x100-square map at 4 samples per square takes
 * hundreds of milliseconds, too slow for sculpting on every pointer move.
 */
export function updateTerrainRegion(geometry: BufferGeometry, field: HeightField, rect: SampleRect): void {
  const { cols, spacingFt, data } = field;
  const { border, surfaceCount } = geometry.userData.terrainLayout as TerrainLayout;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  const positions = position.array as Float32Array;
  let low = Infinity;
  let high = -Infinity;
  for (let r = rect.r0; r <= rect.r1; r++) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const i = r * cols + c;
      positions[i * 3 + 1] = data[i]!;
      low = Math.min(low, data[i]!);
      high = Math.max(high, data[i]!);
    }
  }
  const ring = border.length;
  const previousBottom = positions[(surfaceCount + ring) * 3 + 1]!;
  // The skirt only deepens here; a full update tightens it again later.
  const bottom = Math.min(previousBottom, low - SKIRT_FT);
  border.forEach((top, i) => {
    positions[(surfaceCount + i) * 3 + 1] = positions[top * 3 + 1]!;
    positions[(surfaceCount + ring + i) * 3 + 1] = bottom;
  });
  // Skirt faces stay vertical planes, so their normals keep their direction.
  const region = {
    c0: Math.max(0, rect.c0 - 1),
    r0: Math.max(0, rect.r0 - 1),
    c1: Math.min(cols - 1, rect.c1 + 1),
    r1: Math.min(field.rows - 1, rect.r1 + 1),
  };
  updateSurfaceNormals(field, normal.array as Float32Array, region);
  position.addUpdateRange(rect.r0 * cols * 3, (rect.r1 - rect.r0 + 1) * cols * 3);
  position.addUpdateRange(surfaceCount * 3, ring * 2 * 3);
  position.needsUpdate = true;
  normal.addUpdateRange(region.r0 * cols * 3, (region.r1 - region.r0 + 1) * cols * 3);
  normal.needsUpdate = true;
  const box = geometry.boundingBox!;
  box.min.y = Math.min(box.min.y, bottom);
  box.max.y = Math.max(box.max.y, high);
  box.getBoundingSphere(geometry.boundingSphere!);
  const bvh = geometry.boundsTree as MeshBVH | undefined;
  const s = spacingFt;
  const min = { x: (region.c0 - 1) * s, y: (region.r0 - 1) * s };
  const max = { x: (region.c1 + 1) * s, y: (region.r1 + 1) * s };
  if (bvh) refitRegion(bvh, field, min, max, bottom !== previousBottom);
}
