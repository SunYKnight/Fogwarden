import { Line } from '@react-three/drei';
import type { MapPoint } from '@/core/model';
import { gridDistanceFt } from '@/core/rules/distance';
import { useMapRender } from '@/render/mapRenderContext';
import { MarkerShape } from '@/render/markers/MarkerShape';
import { snapTokenPoint } from '@/render/tokens/tokenPlacement';
import { TextLabel } from '@/render/TextLabel';
import { TokenView } from '@/render/tokens/TokenView';
import { useAppStore } from '@/state/appStore';
import { currentCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useCombatantToken } from '@/state/libraryStore';
import { useCombatantTypeIcon } from './creatureLookup';
import { directionDeg } from './encounterPointer';
import { useEncounterUi } from './encounterUiStore';

const LINE_LIFT_FT = 1;
const NO_RAYCAST = () => undefined;

function useDiagonalRule() {
  return useAppStore((s) => s.settings?.diagonalRule ?? '5-5-5');
}

function Ruler({ from, to, label }: { from: MapPoint; to: MapPoint; label: string }) {
  return (
    <>
      <Line
        points={[
          [from.x, from.elevationFt + LINE_LIFT_FT, from.y],
          [to.x, to.elevationFt + LINE_LIFT_FT, to.y],
        ]}
        color="#ffffff"
        lineWidth={2}
        dashed
        dashSize={1}
        gapSize={0.6}
        raycast={NO_RAYCAST}
      />
      <TextLabel position={[to.x, to.elevationFt + LINE_LIFT_FT + 1, to.y]} lines={[{ text: label }]} />
    </>
  );
}

function MeasureOverlay() {
  const measure = useEncounterUi((s) => s.measure);
  const { map } = useMapRender();
  const rule = useDiagonalRule();
  const grid = measure && gridDistanceFt(measure.from, measure.to, map.grid, rule);
  const direct =
    measure &&
    Math.hypot(
      measure.to.x - measure.from.x,
      measure.to.y - measure.from.y,
      measure.to.elevationFt - measure.from.elevationFt,
    );
  return measure && direct !== null ? (
    <Ruler from={measure.from} to={measure.to} label={`${grid} ft · ${direct.toFixed(1)} ft direct`} />
  ) : null;
}

/** Ghost token at the drop position with the movement distance by the grid rule. */
function DragOverlay() {
  const drag = useEncounterUi((s) => s.drag);
  const combatant = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.id === drag?.combatantId));
  const current = useEncounterStore((s) => (s.encounter ? currentCombatant(s.encounter)?.id : undefined));
  const turnStart = useEncounterStore((s) => s.encounter?.turnStart ?? null);
  const token = useCombatantToken(combatant);
  const icon = useCombatantTypeIcon(combatant?.creature);
  const { map } = useMapRender();
  const rule = useDiagonalRule();
  const moved = drag && (drag.from.x !== drag.to.x || drag.from.y !== drag.to.y);
  const feet = drag && gridDistanceFt(drag.from, drag.to, map.grid, rule);
  // The turn's total matters for speed; this drag alone may be its second leg.
  const turnFeet =
    drag && current === drag.combatantId && turnStart ? gridDistanceFt(turnStart, drag.to, map.grid, rule) : null;
  const caption = turnFeet === null || turnFeet === feet ? `${feet} ft` : `${feet} ft · ${turnFeet} ft this turn`;
  return moved && combatant ? (
    <>
      <TokenView
        {...combatant}
        token={token}
        icon={icon}
        position={drag.to}
        health={null}
        ghost
        interactive={false}
        caption={caption}
      />
      <Line
        points={[
          [drag.from.x, drag.from.elevationFt + LINE_LIFT_FT, drag.from.y],
          [drag.to.x, drag.to.elevationFt + LINE_LIFT_FT, drag.to.y],
        ]}
        color="#ffffff"
        lineWidth={2}
        raycast={NO_RAYCAST}
      />
    </>
  ) : null;
}

function PlacingOverlay() {
  const placingId = useEncounterUi((s) => s.placingId);
  const pointer = useEncounterUi((s) => s.pointer);
  const combatant = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.id === placingId));
  const token = useCombatantToken(combatant);
  const icon = useCombatantTypeIcon(combatant?.creature);
  const { map, terrain } = useMapRender();
  const position = combatant && pointer && snapTokenPoint(pointer, combatant.size, map.grid, terrain);
  return combatant && position ? (
    <TokenView {...combatant} token={token} icon={icon} position={position} health={null} ghost interactive={false} />
  ) : null;
}

function MarkerPlacementOverlay() {
  const placement = useEncounterUi((s) => s.placement);
  const pointer = useEncounterUi((s) => s.pointer);
  const origin = placement?.origin ?? pointer;
  return placement && origin ? (
    <MarkerShape
      marker={{
        ...placement.template,
        label: placement.template.name,
        origin,
        directionDeg: placement.origin && pointer ? directionDeg(placement.origin, pointer) : 0,
      }}
    />
  ) : null;
}

/** Previews of the encounter page interactions, rendered inside the map canvas. */
export function EncounterOverlay() {
  return (
    <>
      <MeasureOverlay />
      <DragOverlay />
      <PlacingOverlay />
      <MarkerPlacementOverlay />
    </>
  );
}
