import type { AssetRef, CreatureSize, MapPoint, Side } from '@/core/model';
import { TextLabel, type LabelLine } from '../TextLabel';
import type { HitTag } from '../mapRenderContext';
import { TOKEN_DIAMETER_FT } from './tokenPlacement';
import { useAssetTexture } from './useAssetTexture';

export const SIDE_COLORS: Record<Side, string> = {
  player: '#3d8bfd',
  ally: '#46b45a',
  enemy: '#e04040',
  neutral: '#e0c040',
};

const DISC_HEIGHT_FT = 0.6;
const GHOST_OPACITY = 0.4;
const NO_RAYCAST = () => undefined;

function healthColor(fraction: number): string {
  return fraction > 0.5 ? '#4caf50' : fraction > 0.25 ? '#e0a030' : fraction > 0 ? '#e04040' : '#777777';
}

export interface TokenViewProps {
  id: string;
  name: string;
  side: Side;
  size: CreatureSize;
  position: MapPoint;
  token: AssetRef | null;
  /** Remaining health 0..1; null hides the band. */
  health: number | null;
  ghost?: boolean;
  selected?: boolean;
  current?: boolean;
  /** Preview tokens must not catch the pointer that drags them. */
  interactive?: boolean;
  /** Extra text under the name, e.g. the movement distance while dragging. */
  caption?: string;
}

/** Token disc with the creature picture on top, a ring in the side color, name label and health band. */
export function TokenView(props: TokenViewProps) {
  const { id, name, side, size, position, health, ghost = false, interactive = true } = props;
  const texture = useAssetTexture(props.token);
  const radius = (TOKEN_DIAMETER_FT[size] / 2) * 0.92;
  const hit: HitTag = { kind: 'token', id };
  const raycast = interactive ? undefined : NO_RAYCAST;
  const material = { transparent: ghost, opacity: ghost ? GHOST_OPACITY : 1, depthWrite: !ghost };
  const labelLines: LabelLine[] = [
    { text: name },
    ...(props.caption ? [{ text: props.caption, color: '#d4a24c', bold: true }] : []),
  ];
  return (
    <group position={[position.x, position.elevationFt, position.y]} userData={interactive ? { hit } : {}}>
      <mesh position={[0, DISC_HEIGHT_FT / 2, 0]} raycast={raycast} castShadow>
        <cylinderGeometry args={[radius, radius, DISC_HEIGHT_FT, 40]} />
        <meshStandardMaterial color={SIDE_COLORS[side]} {...material} />
      </mesh>
      <mesh position={[0, DISC_HEIGHT_FT + 0.02, 0]} rotation-x={-Math.PI / 2} raycast={raycast}>
        <circleGeometry args={[radius * 0.82, 40]} />
        <meshBasicMaterial
          key={texture?.uuid ?? 'plain'}
          map={texture}
          color={texture ? '#ffffff' : '#2a2d35'}
          {...material}
        />
      </mesh>
      {(props.selected || props.current) && (
        <mesh position={[0, 0.08, 0]} rotation-x={-Math.PI / 2} raycast={NO_RAYCAST}>
          <ringGeometry args={[radius * 1.05, radius * 1.05 + 0.6, 48]} />
          <meshBasicMaterial color={props.current ? '#ffc940' : '#ffffff'} />
        </mesh>
      )}
      {props.selected && props.current && (
        <mesh position={[0, 0.08, 0]} rotation-x={-Math.PI / 2} raycast={NO_RAYCAST}>
          <ringGeometry args={[radius * 1.05 + 0.7, radius * 1.05 + 1.1, 48]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      <TextLabel
        position={[0, DISC_HEIGHT_FT, radius + 1.4]}
        lines={labelLines}
        bar={health === null ? null : { fraction: health, color: healthColor(health) }}
        opacity={ghost ? 0.6 : 1}
      />
    </group>
  );
}
