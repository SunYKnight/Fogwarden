import { useMemo, type ComponentType } from 'react';
import { BoxGeometry, Color, MeshStandardMaterial, type Material } from 'three';
import type { Opening, OpeningKind, OpeningState, Wall } from '@/core/model';
import { wallCorners, type WallCorner } from '@/core/geometry/wallOutline';
import { distance2, lerp2, wallBaseAt, wallPieces, type WallPiece } from '@/core/geometry/walls';
import type { HeightField } from '@/core/terrain/heightfield';
import { createProjectedMaterial, type ProjectionUniforms } from '../materials/projectedMaterial';
import { useMapRender, type HitTag, type RenderMode } from '../mapRenderContext';
import { useOpeningStates } from '../useOpeningStates';
import { useDisposable, useLayerVisible } from './hooks';
import { buildWallGeometry } from './wallGeometry';

// Flat wall tops show the battlemap line, steeper faces the material.
const WALL_SIDE_SLOPE_DEG = 45;
const DOOR_THICKNESS_FT = 0.25;
const PANE_THICKNESS_FT = 0.08;
const BAR_FT = 0.15;
const BAR_SPACING_FT = 0.6;
// Raised bars shrink into the lintel instead of poking out of the wall.
const RAISED_PORTCULLIS_SCALE = 0.12;
const SECRET_TINT = new Color('#5a2d91');

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const GLASS = new MeshStandardMaterial({
  color: '#a8d8ff',
  transparent: true,
  opacity: 0.3,
  roughness: 0.1,
  metalness: 0.1,
  depthWrite: false,
});
const IRON = new MeshStandardMaterial({ color: '#3a3d42', metalness: 0.7, roughness: 0.5 });
// Arrow slits are too narrow to click; an invisible box keeps them selectable.
const HIT_ONLY = new MeshStandardMaterial({ colorWrite: false, depthWrite: false });
const NO_OPENINGS: Opening[] = [];

interface OpeningViewProps {
  opening: Opening;
  widthFt: number;
  heightFt: number;
  depthFt: number;
  open: boolean;
  material: Material;
}

function DoorView({ widthFt, heightFt, open, material }: OpeningViewProps) {
  return (
    <group rotation={[0, open ? Math.PI / 2 : 0, 0]}>
      <mesh
        geometry={UNIT_BOX}
        material={material}
        position={[widthFt / 2, heightFt / 2, 0]}
        scale={[widthFt, heightFt, DOOR_THICKNESS_FT]}
        castShadow
        receiveShadow
      />
    </group>
  );
}

function WindowView({ widthFt, heightFt, open }: OpeningViewProps) {
  return (
    <group rotation={[0, open ? Math.PI / 2 : 0, 0]}>
      <mesh
        geometry={UNIT_BOX}
        material={GLASS}
        position={[widthFt / 2, heightFt / 2, 0]}
        scale={[widthFt, heightFt, PANE_THICKNESS_FT]}
      />
    </group>
  );
}

function PortcullisView({ widthFt, heightFt, open }: OpeningViewProps) {
  const count = Math.max(2, Math.round(widthFt / BAR_SPACING_FT));
  return (
    <group position={[0, heightFt, 0]} scale={[1, open ? RAISED_PORTCULLIS_SCALE : 1, 1]}>
      {Array.from({ length: count }, (_, i) => (
        <mesh
          key={i}
          geometry={UNIT_BOX}
          material={IRON}
          position={[((i + 0.5) * widthFt) / count, -heightFt / 2, 0]}
          scale={[BAR_FT, heightFt, BAR_FT]}
          castShadow
        />
      ))}
      {[0.3, 0.75].map((f) => (
        <mesh
          key={f}
          geometry={UNIT_BOX}
          material={IRON}
          position={[widthFt / 2, -heightFt * f, 0]}
          scale={[widthFt, BAR_FT, BAR_FT]}
          castShadow
        />
      ))}
    </group>
  );
}

function ArrowSlitView({ widthFt, heightFt, depthFt }: OpeningViewProps) {
  return (
    <mesh
      geometry={UNIT_BOX}
      material={HIT_ONLY}
      position={[widthFt / 2, heightFt / 2, 0]}
      scale={[widthFt, heightFt, depthFt]}
    />
  );
}

const OPENING_VIEWS: Record<OpeningKind, ComponentType<OpeningViewProps>> = {
  door: DoorView,
  window: WindowView,
  portcullis: PortcullisView,
  'arrow-slit': ArrowSlitView,
};

interface OpeningFillProps {
  wall: Wall;
  piece: WallPiece;
  opening: Opening;
  state: OpeningState;
  mode: RenderMode;
  terrain: HeightField;
  uniforms: ProjectionUniforms;
}

/** What fills a hole in the wall, framed at the hinge side: local x along the wall, y up from the sill. */
function OpeningFill({ wall, piece, opening, state, mode, terrain, uniforms }: OpeningFillProps) {
  const start = lerp2(piece.a, piece.b, piece.t0);
  const end = lerp2(piece.a, piece.b, piece.t1);
  const sill = wallBaseAt(wall, lerp2(start, end, 0.5), terrain) + opening.sillFt;
  const secretTint = opening.secret && mode !== 'player';
  // Secret doors wear the wall's material so they blend in once opened too.
  const material = useDisposable(() => {
    const created = createProjectedMaterial(uniforms, {
      side: opening.secret ? wall.material : 'wood',
      sideFromSlopeDeg: WALL_SIDE_SLOPE_DEG,
    });
    if (secretTint) {
      created.emissive.copy(SECRET_TINT);
      created.emissiveIntensity = 0.6;
    }
    return created;
  }, [uniforms, opening.secret, wall.material, secretTint]);
  const hit: HitTag = { kind: 'opening', id: opening.id };
  const View = OPENING_VIEWS[opening.kind];
  return (
    <group
      position={[start.x, sill, start.y]}
      rotation={[0, Math.atan2(start.y - end.y, end.x - start.x), 0]}
      userData={{ hit }}
    >
      <View
        opening={opening}
        widthFt={distance2(start, end)}
        heightFt={Math.max(0.1, Math.min(opening.heightFt, wall.heightFt - opening.sillFt))}
        depthFt={wall.thicknessFt}
        open={state === 'open'}
        material={material}
      />
    </group>
  );
}

interface WallViewProps {
  wall: Wall;
  corners: WallCorner[];
  openings: Opening[];
  states: Record<string, OpeningState>;
  mode: RenderMode;
  terrain: HeightField;
  terrainVersion: number;
  uniforms: ProjectionUniforms;
}

function WallView({ wall, corners, openings, states, mode, terrain, terrainVersion, uniforms }: WallViewProps) {
  // Players see a shut secret door as plain wall.
  const solidKey = openings
    .filter((o) => mode === 'player' && o.secret && states[o.id] !== 'open')
    .map((o) => o.id)
    .join(',');
  const pieces = useMemo(() => wallPieces({ walls: [wall], openings }), [wall, openings]);
  const solid = useMemo(() => new Set(solidKey.split(',')), [solidKey]);
  const terrainKey = wall.baseFt === null ? terrainVersion : -1;
  const geometry = useDisposable(
    () => buildWallGeometry(wall, corners, pieces, solid, terrain),
    [wall, corners, pieces, solid, terrain, terrainKey],
  );
  const material = useDisposable(
    () => createProjectedMaterial(uniforms, { side: wall.material, sideFromSlopeDeg: WALL_SIDE_SLOPE_DEG }),
    [uniforms, wall.material],
  );
  const hit: HitTag = { kind: 'wall', id: wall.id };
  return (
    <group>
      <mesh geometry={geometry} material={material} userData={{ hit }} castShadow receiveShadow />
      {pieces.flatMap((piece) =>
        piece.opening && !solid.has(piece.opening.id)
          ? [
              <OpeningFill
                key={piece.opening.id}
                wall={wall}
                piece={piece}
                opening={piece.opening}
                state={states[piece.opening.id] ?? piece.opening.state}
                mode={mode}
                terrain={terrain}
                uniforms={uniforms}
              />,
            ]
          : [],
      )}
    </group>
  );
}

/** Extruded walls with mitered corners, openings cut out and filled by doors, panes or bars. */
export function StructureLayer() {
  const { map, terrain, terrainVersion, uniforms, mode } = useMapRender();
  const visible = useLayerVisible('walls');
  const states = useOpeningStates();
  const corners = useMemo(() => new Map(map.walls.map((w) => [w.id, wallCorners(w, map.walls)])), [map.walls]);
  const openingsByWall = useMemo(() => Map.groupBy(map.openings, (o) => o.wallId), [map.openings]);
  return visible ? (
    <group>
      {map.walls.map((wall) => (
        <WallView
          key={wall.id}
          wall={wall}
          corners={corners.get(wall.id)!}
          openings={openingsByWall.get(wall.id) ?? NO_OPENINGS}
          states={states}
          mode={mode}
          terrain={terrain}
          terrainVersion={terrainVersion}
          uniforms={uniforms}
        />
      ))}
    </group>
  ) : null;
}
