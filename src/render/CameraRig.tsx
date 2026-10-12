import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, type ComponentRef } from 'react';
import { MOUSE, Vector3, type OrthographicCamera as OrthoCam, type PerspectiveCamera as PerspCam } from 'three';

export type CameraMode = 'top' | 'perspective';

/** Serializable camera pose, sent to the player window so it can mirror the DM view. */
export interface CameraState {
  mode: CameraMode;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

interface CameraRigProps {
  mode: CameraMode;
  widthFt: number;
  depthFt: number;
  /** When set, the camera follows this pose instead of user input (player window). */
  follow?: CameraState | null;
  onChange?: (state: CameraState) => void;
}

// Left button belongs to tools and tokens; right pans, middle rotates.
const BUTTONS = { LEFT: undefined, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN } as unknown as {
  LEFT: MOUSE;
  MIDDLE: MOUSE;
  RIGHT: MOUSE;
};

type Controls = ComponentRef<typeof OrbitControls>;

export function CameraRig({ mode, widthFt, depthFt, follow, onChange }: CameraRigProps) {
  const controls = useRef<Controls | null>(null);
  const ortho = useRef<OrthoCam | null>(null);
  const persp = useRef<PerspCam | null>(null);
  const size = useThree((s) => s.size);
  // drei recreates controls on camera change; frame the live instance.
  const liveControls = useThree((s) => s.controls) as Controls | null;
  const framed = useRef<{ key: string; controls: Controls } | null>(null);

  // Frame on map size, mode or controls changes, not on every canvas resize.
  useEffect(() => {
    const key = `${mode}:${widthFt}:${depthFt}`;
    const hasSize = size.width > 0 && size.height > 0;
    const stale = framed.current?.key !== key || framed.current.controls !== liveControls;
    if (liveControls && hasSize && stale && !follow) {
      framed.current = { key, controls: liveControls };
      const center = new Vector3(widthFt / 2, 0, depthFt / 2);
      liveControls.target.copy(center);
      if (mode === 'top' && ortho.current) {
        // A hair south of straight down keeps north at the top of the screen.
        ortho.current.position.set(center.x, Math.max(widthFt, depthFt) * 2 + 50, center.z + 0.01);
        ortho.current.zoom = Math.min(size.width / widthFt, size.height / depthFt) * 0.9;
        ortho.current.updateProjectionMatrix();
      } else if (persp.current) {
        const distance = Math.max(widthFt, depthFt) * 0.9;
        persp.current.position.set(center.x, distance * 0.8, center.z + distance * 0.75);
      }
      liveControls.update();
    }
  }, [mode, widthFt, depthFt, size.width, size.height, follow, liveControls]);

  useEffect(() => {
    const camera = mode === 'top' ? ortho.current : persp.current;
    if (follow && liveControls && camera && follow.mode === mode) {
      camera.position.set(...follow.position);
      liveControls.target.set(...follow.target);
      camera.zoom = follow.zoom;
      camera.updateProjectionMatrix();
      liveControls.update();
    }
  }, [follow, mode, liveControls]);

  const emit = () => {
    const ctl = controls.current;
    const camera = mode === 'top' ? ortho.current : persp.current;
    if (ctl && camera && onChange) {
      onChange({
        mode,
        position: camera.position.toArray() as [number, number, number],
        target: ctl.target.toArray() as [number, number, number],
        zoom: camera.zoom,
      });
    }
  };

  const far = Math.max(widthFt, depthFt) * 20 + 1000;
  return (
    <>
      {mode === 'top' ? (
        <OrthographicCamera ref={ortho} makeDefault near={0.1} far={far} zoom={4} />
      ) : (
        <PerspectiveCamera ref={persp} makeDefault fov={45} near={0.5} far={far} />
      )}
      <OrbitControls
        ref={controls}
        makeDefault
        enabled={!follow}
        enableRotate={mode === 'perspective'}
        enableDamping={false}
        screenSpacePanning={mode === 'top'}
        mouseButtons={BUTTONS}
        maxPolarAngle={Math.PI / 2 - 0.05}
        onChange={emit}
      />
    </>
  );
}
