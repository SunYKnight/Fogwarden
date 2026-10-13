import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Mesh, MeshStandardMaterial } from 'three';
import type { MapPoint, Room, SideMaterial } from '@/core/model';
import { pointInPolygon } from '@/core/geometry/walls';
import type { HeightField } from '@/core/terrain/heightfield';
import { createProjectedMaterial, type ProjectionUniforms } from '../materials/projectedMaterial';
import { useMapRender, type HitTag } from '../mapRenderContext';
import { useCombatantPositions, useDisposable, useLayerVisible } from './hooks';
import { roomFloorGeometry, roomRoofGeometry } from './roomGeometry';

// No camera renders this layer and raycasters skip it.
const HIDDEN_LAYER = 31;

function createRoofMaterial(uniforms: ProjectionUniforms, side: SideMaterial): MeshStandardMaterial {
  // Untinted: the battlemap below a roof is the room's floor.
  const material = createProjectedMaterial(uniforms, { side, sideFromSlopeDeg: 1, sideTint: 0 });
  // Flat roofs would show the battlemap; a cosine above 1 makes every
  // face use the roof material (createProjectedMaterial exposes it).
  material.userData.projection.uSideCos.value = 2;
  return material;
}

interface RoomViewProps {
  room: Room;
  terrain: HeightField;
  terrainVersion: number;
  uniforms: ProjectionUniforms;
  cliffMaterial: SideMaterial;
  cliffSlopeDeg: number;
  showFloor: boolean;
  showRoof: boolean;
  /** Play views peel the roof while the camera or a token is inside. */
  peel: boolean;
  occupied: boolean;
}

function RoomView(props: RoomViewProps) {
  const { room, terrain, terrainVersion, uniforms, peel, occupied } = props;
  const roofRef = useRef<Mesh>(null);
  const floorGeometry = useDisposable(
    () => roomFloorGeometry(room, terrain),
    [room.polygon, room.floorFt, terrain, terrainVersion],
  );
  const roofGeometry = useDisposable(
    () => roomRoofGeometry(room, terrain),
    [room.polygon, room.floorFt, room.ceilingFt, terrain, terrainVersion],
  );
  const floorMaterial = useDisposable(
    () => createProjectedMaterial(uniforms, { side: props.cliffMaterial, sideFromSlopeDeg: props.cliffSlopeDeg }),
    [uniforms, props.cliffMaterial, props.cliffSlopeDeg],
  );
  const roofMaterial = useDisposable(
    () => createRoofMaterial(uniforms, room.roofMaterial),
    [uniforms, room.roofMaterial],
  );

  useFrame(({ camera }) => {
    const cameraInside = pointInPolygon({ x: camera.position.x, y: camera.position.z }, room.polygon);
    roofRef.current?.layers.set(peel && (occupied || cameraInside) ? HIDDEN_LAYER : 0);
  });

  const floorHit: HitTag = { kind: 'room', id: room.id };
  const roofHit: HitTag = { kind: 'roof', id: room.id };
  return (
    <group>
      {props.showFloor && room.floorFt !== null && (
        <mesh geometry={floorGeometry} material={floorMaterial} userData={{ hit: floorHit }} receiveShadow castShadow />
      )}
      {props.showRoof && room.roof && (
        <mesh
          ref={roofRef}
          geometry={roofGeometry}
          material={roofMaterial}
          userData={{ hit: roofHit }}
          receiveShadow
          castShadow
        />
      )}
    </group>
  );
}

/** Room floors and roofs; roofs peel per room in play views when the camera or a token is inside. */
export function RoomLayer() {
  const { map, terrain, terrainVersion, uniforms, mode } = useMapRender();
  const showFloor = useLayerVisible('rooms');
  const showRoof = useLayerVisible('roofs');
  const positions = useCombatantPositions();
  const tokens = useMemo<MapPoint[]>(() => Object.values(positions), [positions]);
  return (
    <group>
      {map.rooms.map((room) => (
        <RoomView
          key={room.id}
          room={room}
          terrain={terrain}
          terrainVersion={terrainVersion}
          uniforms={uniforms}
          cliffMaterial={map.terrain.cliffMaterial}
          cliffSlopeDeg={map.terrain.cliffSlopeDeg}
          showFloor={showFloor}
          showRoof={showRoof}
          peel={mode !== 'editor'}
          occupied={tokens.some((t) => pointInPolygon(t, room.polygon))}
        />
      ))}
    </group>
  );
}
