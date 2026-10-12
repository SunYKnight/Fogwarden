import { Line } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import type { AreaDimensions, Grid, MapPoint } from '@/core/model';
import { areaCells, areaOutline } from '@/core/rules/templates';
import type { HeightField } from '@/core/terrain/heightfield';
import { useMapRender } from '../mapRenderContext';
import { TextLabel } from '../TextLabel';

/** Everything needed to draw an area; placed markers and placement previews both fit. */
export type MarkerShapeData = AreaDimensions & {
  origin: MapPoint;
  directionDeg: number;
  color: string;
  opacity: number;
  label: string;
};

// Lifts keep the overlay above the terrain triangles it is draped over.
const CELL_LIFT_FT = 0.12;
const OUTLINE_LIFT_FT = 0.3;
const OUTLINE_STEP_FT = 1;
const NO_RAYCAST = () => undefined;

/** Affected squares subdivided like the terrain so they follow its slopes. */
function cellGeometry(cells: { col: number; row: number }[], grid: Grid, terrain: HeightField): BufferGeometry {
  const fps = grid.feetPerSquare;
  const steps = Math.max(1, Math.round(fps / terrain.spacingFt));
  const step = fps / steps;
  const positions: number[] = [];
  const vertex = (x: number, y: number) => positions.push(x, terrain.sample(x, y) + CELL_LIFT_FT, y);
  for (const { col, row } of cells) {
    for (let i = 0; i < steps * steps; i++) {
      const x0 = col * fps + (i % steps) * step;
      const y0 = row * fps + Math.floor(i / steps) * step;
      vertex(x0, y0);
      vertex(x0, y0 + step);
      vertex(x0 + step, y0);
      vertex(x0 + step, y0);
      vertex(x0, y0 + step);
      vertex(x0 + step, y0 + step);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Closed outline sampled about every foot so it hugs the terrain. */
function drapedOutline(polygon: { x: number; y: number }[], terrain: HeightField): [number, number, number][] {
  const points: [number, number, number][] = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / OUTLINE_STEP_FT));
    for (let s = 0; s < count; s++) {
      const x = a.x + ((b.x - a.x) * s) / count;
      const y = a.y + ((b.y - a.y) * s) / count;
      points.push([x, terrain.sample(x, y) + OUTLINE_LIFT_FT, y]);
    }
  });
  points.push(points[0]!);
  return points;
}

/** Area of effect draped on the terrain: affected squares filled, template outline drawn. */
export function MarkerShape({ marker }: { marker: MarkerShapeData }) {
  const { map, terrain, terrainVersion } = useMapRender();
  const { shape, sizeFt, widthFt, heightFt, origin, directionDeg } = marker;
  const grid = map.grid;

  const { geometry, outline } = useMemo(() => {
    const area = { shape, sizeFt, widthFt, heightFt, origin, directionDeg };
    // terrainVersion: the field is mutated in place when it changes.
    void terrainVersion;
    return {
      geometry: cellGeometry(areaCells(area, grid), grid, terrain),
      outline: drapedOutline(areaOutline(area, grid), terrain),
    };
  }, [shape, sizeFt, widthFt, heightFt, origin, directionDeg, grid, terrain, terrainVersion]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <mesh geometry={geometry} raycast={NO_RAYCAST} renderOrder={1}>
        <meshBasicMaterial
          color={marker.color}
          transparent
          opacity={marker.opacity}
          depthWrite={false}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-4}
        />
      </mesh>
      {outline.length > 2 && <Line points={outline} color={marker.color} lineWidth={2} raycast={NO_RAYCAST} />}
      {marker.label && (
        <TextLabel
          position={[origin.x, terrain.sample(origin.x, origin.y) + 1, origin.y]}
          lines={[{ text: marker.label }]}
        />
      )}
    </group>
  );
}
