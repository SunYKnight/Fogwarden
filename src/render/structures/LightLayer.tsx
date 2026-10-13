import { Line } from '@react-three/drei';
import { defaultGraphicsSettings, type MapLight } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { useAppStore } from '@/state/appStore';
import { useEditorStore } from '@/state/editorStore';
import { useMapRender, type HitTag } from '../mapRenderContext';
import { circlePoints, drapedPath } from './drape';
import { noRaycast, useCarriedLights, useCombatantPositions, useLayerVisible } from './hooks';

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
  // Rings of every light would hide the map while the DM works on walls or areas.
  const rings = useEditorStore(
    (s) => s.step === 'objects' || (s.selection?.kind === 'light' && s.selection.id === light.id),
  );
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
      {rings && light.brightFt > 0 && (
        <Line
          points={drapedPath(circlePoints(ground, light.brightFt), true, terrain, RING_LIFT_FT)}
          color={color}
          lineWidth={2}
          raycast={noRaycast}
        />
      )}
      {rings && light.dimFt > 0 && (
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
  const carried = useCarriedLights();
  // Player windows load no settings and keep the defaults.
  const { shadowedLights } = useAppStore((s) => s.settings?.graphics) ?? defaultGraphicsSettings();
  const placed = [...map.lights, ...carried].flatMap((light) => {
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
            castShadow={i < shadowedLights}
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
