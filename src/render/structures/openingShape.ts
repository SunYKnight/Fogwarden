import { MeshStandardMaterial } from 'three';
import type { Opening, OpeningKind, SideMaterial, Wall } from '@/core/model';
import { distance2, lerp2, wallBaseAt, type WallPiece } from '@/core/geometry/walls';
import type { HeightField } from '@/core/terrain/heightfield';

// Flat wall tops show the battlemap line, steeper faces the material.
export const WALL_SIDE_SLOPE_DEG = 45;
const DOOR_THICKNESS_FT = 0.25;
const PANE_THICKNESS_FT = 0.08;
const BAR_FT = 0.15;
const BAR_SPACING_FT = 0.6;
// Raised bars shrink into the lintel instead of poking out of the wall.
const RAISED_PORTCULLIS_SCALE = 0.12;

export const GLASS = new MeshStandardMaterial({
  name: 'Glass',
  color: '#a8d8ff',
  transparent: true,
  opacity: 0.3,
  roughness: 0.1,
  metalness: 0.1,
  depthWrite: false,
});
export const IRON = new MeshStandardMaterial({ name: 'Iron', color: '#3a3d42', metalness: 0.7, roughness: 0.5 });

/** Secret doors wear the wall's material so they blend in once opened too. */
export function openingFillSide(opening: Opening, wall: Wall): SideMaterial {
  return opening.secret ? wall.material : 'wood';
}

/** `fill`: door leaf in wood or the wall's material; `hit`: invisible pick box. */
export type OpeningPartMaterial = 'fill' | 'glass' | 'iron' | 'hit';

type Vec3 = [number, number, number];

/** One box of an opening: a unit cube scaled and moved in the opening's frame. */
export interface OpeningPart {
  material: OpeningPartMaterial;
  position: Vec3;
  scale: Vec3;
}

/** Boxes filling an opening, in a group turned (hinge), moved and scaled (raised bars) as a whole. */
export interface OpeningShape {
  rotationY: number;
  position: Vec3;
  scale: Vec3;
  parts: OpeningPart[];
}

interface ShapeSize {
  widthFt: number;
  heightFt: number;
  depthFt: number;
  open: boolean;
}

function leaf(material: OpeningPartMaterial, thicknessFt: number) {
  return ({ widthFt, heightFt, open }: ShapeSize): OpeningShape => ({
    rotationY: open ? Math.PI / 2 : 0,
    position: [0, 0, 0],
    scale: [1, 1, 1],
    parts: [{ material, position: [widthFt / 2, heightFt / 2, 0], scale: [widthFt, heightFt, thicknessFt] }],
  });
}

function portcullis({ widthFt, heightFt, open }: ShapeSize): OpeningShape {
  const count = Math.max(2, Math.round(widthFt / BAR_SPACING_FT));
  const bars = Array.from({ length: count }, (_, i): OpeningPart => ({
    material: 'iron',
    position: [((i + 0.5) * widthFt) / count, -heightFt / 2, 0],
    scale: [BAR_FT, heightFt, BAR_FT],
  }));
  const crossbars = [0.3, 0.75].map((f): OpeningPart => ({
    material: 'iron',
    position: [widthFt / 2, -heightFt * f, 0],
    scale: [widthFt, BAR_FT, BAR_FT],
  }));
  return {
    rotationY: 0,
    position: [0, heightFt, 0],
    scale: [1, open ? RAISED_PORTCULLIS_SCALE : 1, 1],
    parts: [...bars, ...crossbars],
  };
}

function arrowSlit({ widthFt, heightFt, depthFt }: ShapeSize): OpeningShape {
  return {
    rotationY: 0,
    position: [0, 0, 0],
    scale: [1, 1, 1],
    parts: [{ material: 'hit', position: [widthFt / 2, heightFt / 2, 0], scale: [widthFt, heightFt, depthFt] }],
  };
}

const SHAPES: Record<OpeningKind, (size: ShapeSize) => OpeningShape> = {
  door: leaf('fill', DOOR_THICKNESS_FT),
  window: leaf('glass', PANE_THICKNESS_FT),
  portcullis,
  'arrow-slit': arrowSlit,
};

/** Where an opening sits: its hinge-side start on the sill, turned along the wall. */
export interface OpeningFrame {
  position: Vec3;
  rotationY: number;
  shape: OpeningShape;
}

/** What fills a hole in the wall, framed at the hinge side: local x along the wall, y up from the sill. */
export function openingFrame(
  wall: Wall,
  piece: WallPiece,
  opening: Opening,
  open: boolean,
  terrain: HeightField,
): OpeningFrame {
  const start = lerp2(piece.a, piece.b, piece.t0);
  const end = lerp2(piece.a, piece.b, piece.t1);
  const sill = wallBaseAt(wall, lerp2(start, end, 0.5), terrain) + opening.sillFt;
  return {
    position: [start.x, sill, start.y],
    rotationY: Math.atan2(start.y - end.y, end.x - start.x),
    shape: SHAPES[opening.kind]({
      widthFt: distance2(start, end),
      heightFt: Math.max(0.1, Math.min(opening.heightFt, wall.heightFt - opening.sillFt)),
      depthFt: wall.thicknessFt,
      open,
    }),
  };
}
