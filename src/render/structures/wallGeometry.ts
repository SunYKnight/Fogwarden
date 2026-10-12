import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { Vec2, Wall } from '@/core/model';
import { wallSection, type WallCorner } from '@/core/geometry/wallOutline';
import { lerp2, wallBaseAt, type WallPiece } from '@/core/geometry/walls';
import type { HeightField } from '@/core/terrain/heightfield';

// Terrain-following walls reach below ground so slopes show no gap.
const TERRAIN_SINK_FT = 0.5;

interface Section extends WallCorner {
  bottom: number;
  top: number;
}

function addQuad(out: number[], quad: Vector3[], center: Vector3): void {
  const [a, b, c, d] = quad as [Vector3, Vector3, Vector3, Vector3];
  const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
  const mid = new Vector3().add(a).add(b).add(c).add(d).multiplyScalar(0.25).sub(center);
  const order = normal.dot(mid) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  for (const p of order) {
    out.push(p.x, p.y, p.z);
  }
}

/** Prism between two wall sections; the bottom is left open because terrain or floor covers it. */
function addPrism(out: number[], s: Section, e: Section): void {
  const at = (p: Vec2, h: number) => new Vector3(p.x, h, p.y);
  const sLb = at(s.left, s.bottom);
  const sLt = at(s.left, s.top);
  const sRb = at(s.right, s.bottom);
  const sRt = at(s.right, s.top);
  const eLb = at(e.left, e.bottom);
  const eLt = at(e.left, e.top);
  const eRb = at(e.right, e.bottom);
  const eRt = at(e.right, e.top);
  const center = new Vector3()
    .add(sLb)
    .add(sLt)
    .add(sRb)
    .add(sRt)
    .add(eLb)
    .add(eLt)
    .add(eRb)
    .add(eRt)
    .multiplyScalar(1 / 8);
  addQuad(out, [sLb, eLb, eLt, sLt], center);
  addQuad(out, [sRb, eRb, eRt, sRt], center);
  addQuad(out, [sLt, eLt, eRt, sRt], center);
  addQuad(out, [sLb, sRb, sRt, sLt], center);
  addQuad(out, [eLb, eRb, eRt, eLt], center);
}

/**
 * Solid body of one wall: full-height prisms for wall pieces and sill/lintel prisms around
 * openings. Openings listed in `solidOpenings` are filled like wall (secret doors for players).
 */
export function buildWallGeometry(
  wall: Wall,
  corners: WallCorner[],
  pieces: WallPiece[],
  solidOpenings: Set<string>,
  terrain: HeightField | null,
): BufferGeometry {
  const positions: number[] = [];
  const sink = wall.baseFt === null ? TERRAIN_SINK_FT : 0;
  for (const piece of pieces) {
    const opening = piece.opening && !solidOpenings.has(piece.opening.id) ? piece.opening : null;
    const start = wallSection(wall, corners, piece.segment, piece.t0);
    const end = wallSection(wall, corners, piece.segment, piece.t1);
    const startBase = wallBaseAt(wall, lerp2(piece.a, piece.b, piece.t0), terrain);
    const endBase = wallBaseAt(wall, lerp2(piece.a, piece.b, piece.t1), terrain);
    const bands: [number, number][] = opening
      ? [
          [opening.sillFt > 0 ? -sink : 0, opening.sillFt],
          [opening.sillFt + opening.heightFt, wall.heightFt],
        ]
      : [[-sink, wall.heightFt]];
    for (const [low, high] of bands.filter(([low, high]) => high > low)) {
      addPrism(
        positions,
        { ...start, bottom: startBase + low, top: startBase + high },
        { ...end, bottom: endBase + low, top: endBase + high },
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
