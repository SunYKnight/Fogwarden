import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import type { Vec2 } from '@/core/model';
import { useMapRender } from '@/render/mapRenderContext';
import { useTerrainToolStore } from './terrainToolStore';

/** Keeps overlay lines visibly above the surface they follow. */
const LIFT_FT = 0.15;
const RING_POINTS = 48;

// Overlays must never become the pointer target in place of the terrain below.
const noRaycast = () => undefined;

/**
 * Line segment pairs (x, y, z) along a polyline, split every `stepFt` so the line follows `heightAt`
 * (usually the terrain) instead of cutting through hills.
 */
export function overlayPositions(
  points: Vec2[],
  closed: boolean,
  stepFt: number,
  heightAt: (point: Vec2) => number,
): Float32Array {
  const values: number[] = [];
  const edges = closed ? points.length : points.length - 1;
  for (let e = 0; e < edges; e++) {
    const a = points[e]!;
    const b = points[(e + 1) % points.length]!;
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepFt));
    const push = (t: number) => {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      values.push(p.x, heightAt(p) + LIFT_FT, p.y);
    };
    for (let k = 0; k < pieces; k++) {
      push(k / pieces);
      push((k + 1) / pieces);
    }
  }
  return new Float32Array(values);
}

export function circlePoints(center: Vec2, radiusFt: number): Vec2[] {
  return Array.from({ length: RING_POINTS }, (_, i) => {
    const angle = (i / RING_POINTS) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radiusFt, y: center.y + Math.sin(angle) * radiusFt };
  });
}

export function OverlayLines({ positions, color }: { positions: Float32Array; color: string }) {
  const geometry = useMemo(
    () => new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3)),
    [positions],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={noRaycast} renderOrder={10} frustumCulled={false}>
      <lineBasicMaterial color={color} depthTest={false} transparent />
    </lineSegments>
  );
}

/**
 * Brush outline draped on the terrain under the pointer. Rebuilt on every render: the context changes
 * with each terrain version, and the height field is mutated in place while sculpting.
 */
export function BrushCursor() {
  const { terrain } = useMapRender();
  const cursor = useTerrainToolStore((s) => s.cursor);
  const radiusFt = useTerrainToolStore((s) => s.radiusFt);
  const positions =
    cursor &&
    overlayPositions(circlePoints(cursor, radiusFt), true, terrain.spacingFt, (p) => terrain.sample(p.x, p.y));
  return positions && <OverlayLines positions={positions} color="#ffd54a" />;
}
