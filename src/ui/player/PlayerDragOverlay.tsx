import { Line } from '@react-three/drei';
import { gridDistanceFt } from '@/core/rules/distance';
import { useMapRender } from '@/render/mapRenderContext';
import { TokenView } from '@/render/tokens/TokenView';
import { usePlayerPointer } from './playerPointer';
import { usePlayerStore } from './playerStore';

const LINE_LIFT_FT = 1;
const NO_RAYCAST = () => undefined;

/** Ghost of the player's own token at the drop square with the distance by the DM's grid rule. */
export function PlayerDragOverlay() {
  const drag = usePlayerPointer((s) => s.drag);
  const rule = usePlayerStore((s) => s.encounter?.ownMoves);
  const combatant = usePlayerStore((s) => s.encounter?.combatants.find((c) => c.id === drag?.combatantId));
  const { map } = useMapRender();
  const moved = drag && (drag.from.x !== drag.to.x || drag.from.y !== drag.to.y);
  return moved && combatant && rule ? (
    <>
      <TokenView
        {...combatant}
        position={drag.to}
        health={null}
        ghost
        interactive={false}
        caption={`${gridDistanceFt(drag.from, drag.to, map.grid, rule)} ft`}
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
