import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape, ShapeUtils, Vector2 } from 'three';
import type { Vec2 } from '@/core/model';
import { distance2, lerp2 } from '@/core/geometry/walls';
import type { HeightField } from '@/core/terrain/heightfield';

/** World point `[x, y, z]` hovering `liftFt` above the terrain at a map point. */
export function terrainPoint(terrain: HeightField, p: Vec2, liftFt: number): [number, number, number] {
  return [p.x, terrain.sample(p.x, p.y) + liftFt, p.y];
}

/** Closed circle outline on the map plane. */
export function circlePoints(center: Vec2, radius: number, segments = 48): Vec2[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius };
  });
}
/**
 * Polygon triangulated and subdivided until no edge is longer than about two terrain samples, each
 * vertex lifted above the terrain, so large regions follow hills instead of cutting through them.
 */
export function drapedPolygonGeometry(polygon: Vec2[], terrain: HeightField, liftFt: number): BufferGeometry {
  const maxEdge = Math.max(terrain.spacingFt * 2, 1);
  const contour = polygon.map((p) => new Vector2(p.x, p.y));
  const stack: [Vec2, Vec2, Vec2][] = ShapeUtils.triangulateShape(contour, []).map(([i, j, k]) => [
    polygon[i!]!,
    polygon[j!]!,
    polygon[k!]!,
  ]);
  const positions: number[] = [];
  while (stack.length > 0) {
    const [a, b, c] = stack.pop()!;
    const ab = distance2(a, b);
    const bc = distance2(b, c);
    const ca = distance2(c, a);
    const longest = Math.max(ab, bc, ca);
    if (longest <= maxEdge) {
      positions.push(...terrainPoint(terrain, a, liftFt), ...terrainPoint(terrain, b, liftFt));
      positions.push(...terrainPoint(terrain, c, liftFt));
    } else if (longest === ab) {
      const m = lerp2(a, b, 0.5);
      stack.push([a, m, c], [m, b, c]);
    } else if (longest === bc) {
      const m = lerp2(b, c, 0.5);
      stack.push([a, b, m], [a, m, c]);
    } else {
      const m = lerp2(c, a, 0.5);
      stack.push([a, b, m], [m, b, c]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Polyline sampled every `stepFt` and lifted above the terrain, for outlines and previews. */
export function drapedPath(
  points: Vec2[],
  closed: boolean,
  terrain: HeightField,
  liftFt: number,
  stepFt = 2.5,
): [number, number, number][] {
  const ring = closed && points.length > 2 ? [...points, points[0]!] : points;
  const samples = ring.slice(1).flatMap((b, i) => {
    const a = ring[i]!;
    const steps = Math.max(1, Math.ceil(distance2(a, b) / stepFt));
    return Array.from({ length: steps }, (_, s) => lerp2(a, b, (s + 1) / steps));
  });
  return [...ring.slice(0, 1), ...samples].map((p) => terrainPoint(terrain, p, liftFt));
}

/**
 * Flat slab with the polygon as outline, from `bottomFt` to `topFt` in world space
 * (map y becomes world z).
 */
export function slabGeometry(polygon: Vec2[], bottomFt: number, topFt: number): ExtrudeGeometry {
  const shape = new Shape(polygon.map((p) => new Vector2(p.x, p.y)));
  const geometry = new ExtrudeGeometry(shape, { depth: Math.max(0.05, topFt - bottomFt), bevelEnabled: false });
  // Shape plane XY -> world XZ; the extrusion then runs downwards from y = 0.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, topFt, 0);
  return geometry;
}
