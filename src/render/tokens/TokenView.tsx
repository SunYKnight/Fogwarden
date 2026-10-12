import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Mesh, PerspectiveCamera, Vector3, type Group, type Intersection, type Raycaster, type Texture } from 'three';
import type { CreatureIconKey } from '@/core/creatureTypeIcon';
import type { AssetRef, CreatureSize, MapPoint, Side } from '@/core/model';
import { CREATURE_SPACE_FT } from '@/core/rules/space';
import { useAppStore } from '@/state/appStore';
import { CREATURE_ICON_PATHS, CREATURE_ICON_VIEW } from '@/ui/creatureTypes/creatureIconPaths';
import { usePlayerStore } from '@/ui/player/playerStore';
import { TextLabel, type LabelLine } from '../TextLabel';
import { useMapRender, type HitTag } from '../mapRenderContext';
import { cardHeightRatio, tokenInitials, tokenNumber } from './standee';
import {
  FRAME_MATERIALS,
  initialsCard,
  PLAIN_TOP_MATERIALS,
  portraitLook,
  RING_MATERIALS,
  ringGeometry,
  SIDE_COLORS,
  SIDE_MATERIALS,
  TOKEN_GEOMETRY,
  typeIconTexture,
} from './tokenMaterials';
import { useAssetTexture } from './useAssetTexture';

const DISC_HEIGHT_FT = 0.6;
const BASE_HEIGHT_FT = 0.4;
const CARD_DEPTH_FT = 0.12;
/** Card width per token diameter. */
const CARD_WIDTH = 0.85;
/** Card frame around the picture per card width. */
const CARD_BORDER = 0.05;
const LABEL_GAP_FT = 0.8;
const NO_RAYCAST = () => undefined;
const view = new Vector3();

function healthColor(fraction: number): string {
  return fraction > 0.5 ? '#4caf50' : fraction > 0.25 ? '#e0a030' : fraction > 0 ? '#e04040' : '#777777';
}

// Pointer events must report the ground under a standee, not a point high on
// the card: drops, the ruler and markers aim at the floor. Card meshes are
// children of the billboard group, whose parent stands at the token centre.
function raycastToBase(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
  const first = intersects.length;
  Mesh.prototype.raycast.call(this, raycaster, intersects);
  for (let i = first; i < intersects.length; i++) {
    this.parent?.parent?.getWorldPosition(intersects[i]!.point);
  }
}

/** Standees in the perspective camera unless the DM chose discs; players follow the DM's choice. */
function useStandees(): boolean {
  const { mode } = useMapRender();
  const dmChoice = useAppStore((s) => s.settings?.tokenStandees ?? true);
  const playerChoice = usePlayerStore((s) => s.encounter?.standees ?? true);
  const perspective = useThree((s) => s.camera instanceof PerspectiveCamera);
  return perspective && (mode === 'player' ? playerChoice : dmChoice);
}

export interface TokenViewProps {
  id: string;
  name: string;
  side: Side;
  size: CreatureSize;
  position: MapPoint;
  token: AssetRef | null;
  /** Creature type icon for a token without picture; null shows initials instead. */
  icon?: CreatureIconKey | null;
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

interface PartProps {
  side: Side;
  radius: number;
  texture: Texture | null;
  ghost: boolean;
  raycast: typeof NO_RAYCAST | undefined;
}

function Disc({ side, radius, texture, ghost, raycast }: PartProps) {
  const look = ghost ? 'ghost' : 'solid';
  return (
    <>
      <mesh
        geometry={TOKEN_GEOMETRY.cylinder}
        material={SIDE_MATERIALS[side][look]}
        scale={[radius, DISC_HEIGHT_FT, radius]}
        raycast={raycast}
        castShadow
      />
      <mesh
        geometry={TOKEN_GEOMETRY.circle}
        material={texture ? portraitLook(texture).disc[look] : PLAIN_TOP_MATERIALS[look]}
        position-y={DISC_HEIGHT_FT + 0.02}
        scale={radius * 0.82}
        raycast={raycast}
      />
    </>
  );
}

interface StandeeProps extends PartProps {
  name: string;
  frame: 'current' | 'selected' | null;
  cardWidth: number;
  cardHeight: number;
}

function Standee({ side, radius, texture, ghost, raycast, name, frame, cardWidth, cardHeight }: StandeeProps) {
  const look = ghost ? 'ghost' : 'solid';
  const billboard = useRef<Group>(null);
  const initials = tokenInitials(name);
  const plain = useMemo(() => (texture ? null : initialsCard(initials, SIDE_COLORS[side])), [texture, initials, side]);
  useEffect(
    () => () => {
      plain?.texture.dispose();
      plain?.materials.solid.dispose();
      plain?.materials.ghost.dispose();
    },
    [plain],
  );

  // Only the vertical axis turns: the card stays upright like a paper mini.
  useFrame(({ camera }) => {
    const group = billboard.current;
    if (group) {
      camera.getWorldDirection(view);
      group.rotation.y = Math.atan2(-view.x, -view.z);
    }
  });

  const border = cardWidth * CARD_BORDER;
  const picture = texture ? portraitLook(texture).card[look] : plain?.materials[look];
  const cardRaycast = raycast ?? raycastToBase;
  return (
    <>
      <mesh
        geometry={TOKEN_GEOMETRY.cylinder}
        material={SIDE_MATERIALS[side][look]}
        scale={[radius, BASE_HEIGHT_FT, radius]}
        raycast={raycast}
        castShadow={!ghost}
      />
      <group ref={billboard} position-y={BASE_HEIGHT_FT}>
        <mesh
          geometry={TOKEN_GEOMETRY.box}
          material={(frame ? FRAME_MATERIALS[frame] : SIDE_MATERIALS[side])[look]}
          scale={[cardWidth + border * 2, cardHeight + border * 2, CARD_DEPTH_FT]}
          raycast={cardRaycast}
          castShadow={!ghost}
        />
        <mesh
          geometry={TOKEN_GEOMETRY.plane}
          material={picture}
          position={[0, border, CARD_DEPTH_FT / 2 + 0.01]}
          scale={[cardWidth, cardHeight, 1]}
          raycast={cardRaycast}
        />
      </group>
    </>
  );
}

/**
 * Combatant token: a disc with the creature picture on top in the top view, an upright card on a base
 * (billboard around the vertical axis) in the 3D view. Side color, selection and current-turn rings, name
 * label and health band are the same in both.
 */
export function TokenView(props: TokenViewProps) {
  const { id, name, side, size, position, health, icon, ghost = false, interactive = true } = props;
  const picture = useAssetTexture(props.token);
  const iconCard = useMemo(
    () =>
      picture || !icon
        ? null
        : typeIconTexture(CREATURE_ICON_PATHS[icon], CREATURE_ICON_VIEW, SIDE_COLORS[side], tokenNumber(name)),
    [picture, icon, side, name],
  );
  // Disposing the texture also frees the looks portraitLook built from it.
  useEffect(() => () => iconCard?.dispose(), [iconCard]);
  const texture = picture ?? iconCard;
  const standee = useStandees();
  const diameter = CREATURE_SPACE_FT[size];
  const radius = (diameter / 2) * 0.92;
  const cardWidth = diameter * CARD_WIDTH;
  const cardHeight = cardWidth * (texture ? portraitLook(texture).cardRatio : cardHeightRatio(null));
  const hit: HitTag = { kind: 'token', id };
  const raycast = interactive ? undefined : NO_RAYCAST;
  const part = { side, radius, texture, ghost, raycast };
  const frame = props.current ? 'current' : props.selected ? 'selected' : null;
  const labelLines: LabelLine[] = [
    { text: name },
    ...(props.caption ? [{ text: props.caption, color: '#d4a24c', bold: true }] : []),
  ];
  const cardTop = BASE_HEIGHT_FT + cardHeight + cardWidth * CARD_BORDER * 2;
  const ringInner = radius * 1.05;
  return (
    <group position={[position.x, position.elevationFt, position.y]} userData={interactive ? { hit } : {}}>
      {standee ? (
        <Standee {...part} name={name} frame={frame} cardWidth={cardWidth} cardHeight={cardHeight} />
      ) : (
        <Disc {...part} />
      )}
      {frame && (
        <mesh
          geometry={ringGeometry(ringInner, ringInner + 0.6)}
          material={RING_MATERIALS[frame]}
          position-y={0.08}
          raycast={NO_RAYCAST}
        />
      )}
      {props.selected && props.current && (
        <mesh
          geometry={ringGeometry(ringInner + 0.7, ringInner + 1.1)}
          material={RING_MATERIALS.selected}
          position-y={0.08}
          raycast={NO_RAYCAST}
        />
      )}
      <TextLabel
        position={standee ? [0, cardTop + LABEL_GAP_FT, 0] : [0, DISC_HEIGHT_FT, radius + 1.4]}
        lines={labelLines}
        bar={health === null ? null : { fraction: health, color: healthColor(health) }}
        opacity={ghost ? 0.6 : 1}
      />
    </group>
  );
}
