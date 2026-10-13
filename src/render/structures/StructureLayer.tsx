import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { BoxGeometry, Color, MeshStandardMaterial, type Material } from 'three';
import type { Opening, OpeningState, Wall } from '@/core/model';
import { wallCorners, type WallCorner } from '@/core/geometry/wallOutline';
import { wallPieces, type WallPiece } from '@/core/geometry/walls';
import type { HeightField } from '@/core/terrain/heightfield';
import { useEncounterUi } from '@/ui/encounter/encounterUiStore';
import { createProjectedMaterial, type ProjectionUniforms } from '../materials/projectedMaterial';
import { useMapRender, type HitTag, type RenderMode } from '../mapRenderContext';
import { useOpeningStates } from '../useOpeningStates';
import { noRaycast, useDisposable, useLayerVisible } from './hooks';
import {
  GLASS,
  IRON,
  openingFillSide,
  openingFrame,
  WALL_SIDE_SLOPE_DEG,
  type OpeningPartMaterial,
} from './openingShape';
import { buildWallGeometry } from './wallGeometry';

const SECRET_TINT = new Color('#5a2d91');
// Doors are thin seen from above: the DM gets a white outline around each
// opening at the wall top, drawn over trees and roofs.
const OUTLINE_LIFT_FT = 0.1;
const OUTLINE_MARGIN_FT = 0.4;
const OUTLINE_RENDER_ORDER = 20;
const OUTLINE_HIT_FT = 1;
const OUTLINE_HIT_HEIGHT_FT = 0.1;

const UNIT_BOX = new BoxGeometry(1, 1, 1);
// Arrow slits are too narrow to click; an invisible box keeps them selectable.
const HIT_ONLY = new MeshStandardMaterial({ colorWrite: false, depthWrite: false });
const NO_OPENINGS: Opening[] = [];

const PART_SHADOWS: Record<OpeningPartMaterial, { cast: boolean; receive: boolean }> = {
  fill: { cast: true, receive: true },
  glass: { cast: false, receive: false },
  iron: { cast: true, receive: false },
  hit: { cast: false, receive: false },
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

/** What fills a hole in the wall: door leaf, pane, bars or a pick box. */
function OpeningFill({ wall, piece, opening, state, mode, terrain, uniforms }: OpeningFillProps) {
  const hovered = useEncounterUi((s) => s.hover?.kind === 'opening' && s.hover.id === opening.id);
  const secretTint = opening.secret && mode !== 'player';
  const side = openingFillSide(opening, wall);
  const fill = useDisposable(() => {
    const created = createProjectedMaterial(uniforms, { side, sideFromSlopeDeg: WALL_SIDE_SLOPE_DEG });
    if (secretTint) {
      created.emissive.copy(SECRET_TINT);
      created.emissiveIntensity = 0.6;
    }
    return created;
  }, [uniforms, side, secretTint]);
  const materials: Record<OpeningPartMaterial, Material> = { fill, glass: GLASS, iron: IRON, hit: HIT_ONLY };
  const { position, rotationY, shape } = openingFrame(wall, piece, opening, state === 'open', terrain);
  const hit: HitTag = { kind: 'opening', id: opening.id };
  // Local frame: x along the wall from the hinge, y up from the sill.
  const top = wall.heightFt - opening.sillFt + OUTLINE_LIFT_FT;
  const half = wall.thicknessFt / 2 + OUTLINE_MARGIN_FT;
  const end = opening.widthFt;
  // Invisible strips under the outline take the click; the inside stays
  // free for tokens standing in the doorway.
  const strips: { position: [number, number, number]; scale: [number, number, number] }[] = [
    { position: [end / 2, top, -half], scale: [end, OUTLINE_HIT_HEIGHT_FT, OUTLINE_HIT_FT] },
    { position: [end / 2, top, half], scale: [end, OUTLINE_HIT_HEIGHT_FT, OUTLINE_HIT_FT] },
    { position: [0, top, 0], scale: [OUTLINE_HIT_FT, OUTLINE_HIT_HEIGHT_FT, half * 2] },
    { position: [end, top, 0], scale: [OUTLINE_HIT_FT, OUTLINE_HIT_HEIGHT_FT, half * 2] },
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} userData={{ hit }}>
      <group position={shape.position} rotation={[0, shape.rotationY, 0]} scale={shape.scale}>
        {shape.parts.map((part, i) => (
          <mesh
            key={i}
            geometry={UNIT_BOX}
            material={materials[part.material]}
            position={part.position}
            scale={part.scale}
            castShadow={PART_SHADOWS[part.material].cast}
            receiveShadow={PART_SHADOWS[part.material].receive}
          />
        ))}
      </group>
      {mode === 'dm' && (
        <>
          <Line
            points={[
              [0, top, -half],
              [end, top, -half],
              [end, top, half],
              [0, top, half],
              [0, top, -half],
            ]}
            color="#ffffff"
            lineWidth={hovered ? 4 : 2}
            transparent
            opacity={hovered ? 1 : 0.8}
            depthTest={false}
            renderOrder={OUTLINE_RENDER_ORDER}
            raycast={noRaycast}
          />
          {strips.map((strip, i) => (
            <mesh key={i} geometry={UNIT_BOX} material={HIT_ONLY} position={strip.position} scale={strip.scale} />
          ))}
        </>
      )}
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
