import { Line } from '@react-three/drei';
import type { MapLight } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { useMapRender, type HitTag } from '../mapRenderContext';
import { circlePoints, drapedPath } from './drape';
import { noRaycast, useCombatantPositions, useLayerVisible } from './hooks';

// Each shadowed point light renders six depth maps; more stall weak GPUs.
const MAX_SHADOWED_LIGHTS = 8;
const SHADOW_MAP_SIZE = 512;
const LIGHT_INTENSITY = 3;
// Carried torches and lanterns sit at hand height above the token's feet.
const CARRIED_HEIGHT_FT = 4;
const RING_LIFT_FT = 0.3;

type WorldPoint = [number, number, number];

function LightGizmo({ light, position, terrain }: { light: MapLight; position: WorldPoint; terrain: HeightField }) {
  const ground = { x: position[0], y: position[2] };
  const hit: HitTag = { kind: 'light', id: light.id };
  const color = light.enabled ? light.color : '#555555';
  return (
    <group>
      <mesh position={position} userData={{ hit }}>
        <sphereGeometry args={[0.6, 16, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Line
        points={[[ground.x, terrain.sample(ground.x, ground.y), ground.y], position]}
        color={color}
        raycast={noRaycast}
      />
      {light.brightFt > 0 && (
        <Line
          points={drapedPath(circlePoints(ground, light.brightFt), true, terrain, RING_LIFT_FT)}
          color={color}
          lineWidth={2}
          raycast={noRaycast}
        />
      )}
      {light.dimFt > 0 && (
        <Line
          points={drapedPath(circlePoints(ground, light.brightFt + light.dimFt), true, terrain, RING_LIFT_FT)}
          color={color}
          dashed
          dashSize={1}
          gapSize={1}
          raycast={noRaycast}
        />
      )}
    </group>
  );
}

/**
 * Map lights as shadow-casting point lights: full strength within the bright radius, fading out at
 * bright + dim. Lights attached to a combatant follow its token in play views; the editor draws
 * bulb and radius gizmos.
 */
export function LightLayer() {
  const { map, terrain, mode } = useMapRender();
  const visible = useLayerVisible('lights');
  const combatants = useCombatantPositions();
  const placed = map.lights.flatMap((light) => {
    const carrier = light.attachedTo && mode !== 'editor' ? combatants[light.attachedTo] : undefined;
    const position: WorldPoint = carrier
      ? [carrier.x, carrier.elevationFt + CARRIED_HEIGHT_FT, carrier.y]
      : [light.position.x, light.position.elevationFt, light.position.y];
    // A carried light without a placed, visible carrier has nowhere to shine.
    const present = mode === 'editor' || light.attachedTo === null || carrier !== undefined;
    return present ? [{ light, position }] : [];
  });
  const lit = placed.filter((p) => p.light.enabled);
  return visible ? (
    <group>
      {lit.map(({ light, position }, i) => {
        const range = Math.max(1, light.brightFt + light.dimFt);
        return (
          <pointLight
            key={light.id}
            position={position}
            color={light.color}
            intensity={LIGHT_INTENSITY}
            distance={range}
            decay={0}
            castShadow={i < MAX_SHADOWED_LIGHTS}
            shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
            shadow-bias={-0.002}
            shadow-camera-near={0.5}
            shadow-camera-far={range}
          />
        );
      })}
      {mode === 'editor' &&
        placed.map(({ light, position }) => (
          <LightGizmo key={light.id} light={light} position={position} terrain={terrain} />
        ))}
    </group>
  ) : null;
}
