import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, type ReactNode } from 'react';
import type { Object3D } from 'three';
import type { BattleMap, LightLevel } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { CameraRig, type CameraMode, type CameraState } from './CameraRig';
import type { FogMode } from './materials/projectedMaterial';
import {
  MapRenderContext,
  mapSizeFt,
  type HitTag,
  type MapPointerEvent,
  type MapRenderState,
  type RenderMode,
} from './mapRenderContext';
import { TerrainLayer } from './terrain/TerrainLayer';
import { useProjectionUniforms } from './useProjectionUniforms';

const AMBIENT_INTENSITY: Record<LightLevel, number> = {
  bright: 1,
  dim: 0.45,
  darkness: 0.12,
  'magical-darkness': 0.05,
};

/** Hit tag of the object or its nearest tagged ancestor. */
export function findHit(object: Object3D | null): HitTag | null {
  let current = object;
  let hit: HitTag | null = null;
  while (current && !hit) {
    hit = (current.userData.hit as HitTag | undefined) ?? null;
    current = current.parent;
  }
  return hit;
}

function toMapEvent(type: MapPointerEvent['type'], e: ThreeEvent<PointerEvent>): MapPointerEvent {
  return {
    type,
    point: { x: e.point.x, y: e.point.z, elevationFt: e.point.y },
    hit: findHit(e.object),
    button: e.button,
    shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
  };
}

interface MapViewProps {
  map: BattleMap;
  terrain: HeightField;
  terrainVersion: number;
  mode: RenderMode;
  fogMode: FogMode;
  camera: CameraMode;
  /** Lighting level used for the scene; editors pass 'bright' so the whole map stays visible. */
  ambient: LightLevel;
  followCamera?: CameraState | null;
  onCameraChange?: (state: CameraState) => void;
  onPointer?: (event: MapPointerEvent) => void;
  children?: ReactNode;
}

/** 3D canvas for one map; extra layers (walls, tokens, markers, ...) are passed as children. */
export function MapView(props: MapViewProps) {
  const { map, terrain, terrainVersion, mode, fogMode, camera, ambient, onPointer } = props;
  const uniforms = useProjectionUniforms(map, fogMode);
  const { width, depth } = mapSizeFt(map);
  const state = useMemo<MapRenderState>(
    () => ({ map, terrain, terrainVersion, uniforms, mode }),
    [map, terrain, terrainVersion, uniforms, mode],
  );

  // Strokes must end even when the button is released outside every mesh.
  useEffect(() => {
    const up = (e: PointerEvent) =>
      onPointer?.({
        type: 'up',
        point: null,
        hit: null,
        button: e.button,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
      });
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [onPointer]);

  const intensity = AMBIENT_INTENSITY[ambient];
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ background: '#111318' }}
    >
      <MapRenderContext.Provider value={state}>
        <CameraRig
          mode={camera}
          widthFt={width}
          depthFt={depth}
          follow={props.followCamera}
          onChange={props.onCameraChange}
        />
        <hemisphereLight args={['#ffffff', '#444444', 1.2 * intensity]} />
        <directionalLight position={[width * 0.3, Math.max(width, depth), depth * 0.1]} intensity={1.4 * intensity} />
        <group
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointer?.(toMapEvent('down', e));
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            onPointer?.(toMapEvent('move', e));
          }}
        >
          <TerrainLayer />
          {props.children}
        </group>
      </MapRenderContext.Provider>
    </Canvas>
  );
}
