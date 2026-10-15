import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Object3D } from 'three';
import { daylight, skyTint } from '@/core/atmosphere/timeOfDay';
import { defaultGraphicsSettings, type BattleMap, type LightLevel } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { useAppStore } from '@/state/appStore';
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

/** Quiet time after the last terrain change before draped structures rebuild. */
const TERRAIN_SETTLE_MS = 200;

function useSettledVersion(version: number): number {
  const [settled, setSettled] = useState(version);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(version), TERRAIN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [version]);
  return settled;
}

// Display frames arrive a little early or late; without slack 30 fps on a
// 60 Hz screen would often skip to every third frame.
const FRAME_SLACK_MS = 4;

/**
 * Requests a frame of the demand frameloop at most `fps` times a second, so time-driven animations (pings,
 * weather, videos, camera damping) keep running. React updates still render at once: r3f requests a frame
 * for every changed prop and the orbit controls for every camera move.
 */
function FrameRateCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const intervalMs = 1000 / fps;
    let last = -Infinity;
    let handle = 0;
    const tick = (time: number) => {
      if (time - last >= intervalMs - FRAME_SLACK_MS) {
        last = time;
        invalidate();
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [fps, invalidate]);
  return null;
}

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
  /** In-game minute of the day dimming and tinting the light; null or missing keeps `ambient` as is. */
  minute?: number | null;
  followCamera?: CameraState | null;
  onCameraChange?: (state: CameraState) => void;
  onPointer?: (event: MapPointerEvent) => void;
  children?: ReactNode;
}

/** 3D canvas for one map; extra layers (walls, tokens, markers, ...) are passed as children. */
export function MapView(props: MapViewProps) {
  const { map, terrain, terrainVersion, mode, fogMode, camera, ambient, onPointer } = props;
  const uniforms = useProjectionUniforms(map, fogMode);
  const settledTerrainVersion = useSettledVersion(terrainVersion);
  const { width, depth } = mapSizeFt(map);
  const state = useMemo<MapRenderState>(
    () => ({ map, terrain, terrainVersion, settledTerrainVersion, uniforms, mode }),
    [map, terrain, terrainVersion, settledTerrainVersion, uniforms, mode],
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

  const minute = props.minute ?? null;
  // Daylight fades smoothly between the levels so the slider looks continuous.
  const daylit = minute === null ? 1 : AMBIENT_INTENSITY.darkness + (1 - AMBIENT_INTENSITY.darkness) * daylight(minute);
  const intensity = Math.min(AMBIENT_INTENSITY[ambient], daylit);
  const tint = minute === null ? '#ffffff' : skyTint(minute);
  // Player windows load no settings and keep the defaults.
  const graphics = useAppStore((s) => s.settings?.graphics) ?? defaultGraphicsSettings();
  return (
    <Canvas
      // WebGL fixes antialiasing when the context is created.
      key={graphics.antialias ? 'antialias' : 'aliased'}
      shadows="percentage"
      dpr={Math.min(window.devicePixelRatio, 2) * graphics.resolutionScale}
      gl={{ antialias: graphics.antialias }}
      frameloop={graphics.maxFps === null ? 'always' : 'demand'}
      onContextMenu={(e) => e.preventDefault()}
      style={{ background: '#111318' }}
    >
      {graphics.maxFps !== null && <FrameRateCap fps={graphics.maxFps} />}
      <MapRenderContext.Provider value={state}>
        <CameraRig
          mode={camera}
          widthFt={width}
          depthFt={depth}
          follow={props.followCamera}
          onChange={props.onCameraChange}
        />
        <hemisphereLight color={tint} groundColor="#444444" intensity={1.2 * intensity} />
        <directionalLight
          position={[width * 0.3, Math.max(width, depth), depth * 0.1]}
          color={tint}
          intensity={1.4 * intensity}
        />
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
