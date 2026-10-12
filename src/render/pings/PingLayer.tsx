import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh, MeshBasicMaterial } from 'three';
import { usePingStore, type Ping } from '@/state/pingStore';
import { useMapRender } from '../mapRenderContext';
import { TextLabel } from '../TextLabel';

const PULSE_MS = 1000;
const LIFT_FT = 0.5;
const NO_RAYCAST = () => undefined;

/** Ring that grows from the spot to one and a half squares and fades, once per second. */
function PingRing({ ping, reachFt }: { ping: Ping; reachFt: number }) {
  const ring = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    const t = ((performance.now() - ping.startedAt) % PULSE_MS) / PULSE_MS;
    ring.current?.scale.setScalar(1 + t * (reachFt - 1));
    if (material.current) material.current.opacity = 1 - t;
  });
  const { x, y, elevationFt } = ping.at;
  return (
    <group position={[x, elevationFt + LIFT_FT, y]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} raycast={NO_RAYCAST} renderOrder={11}>
        <ringGeometry args={[0.8, 1, 48]} />
        <meshBasicMaterial ref={material} color="#f2c14e" transparent depthTest={false} depthWrite={false} />
      </mesh>
      <TextLabel position={[0, reachFt / 2, 0]} lines={[{ text: ping.by, bold: true, color: '#f2c14e' }]} />
    </group>
  );
}

/** Pings that reached this screen: the DM's and players' pointing, as pulsing rings with who pointed. */
export function PingLayer() {
  const { mode, map } = useMapRender();
  const pings = usePingStore((s) => s.pings);
  const reachFt = map.grid.feetPerSquare * 1.5;
  return mode === 'editor' ? null : pings.map((ping) => <PingRing key={ping.id} ping={ping} reachFt={reachFt} />);
}
