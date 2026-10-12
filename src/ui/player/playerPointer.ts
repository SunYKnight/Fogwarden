import { create } from 'zustand';
import type { MapPoint } from '@/core/model';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { snapTokenPoint } from '@/render/tokens/tokenPlacement';
import type { SyncPayload } from '@/sync/protocol';
import { usePlayerStore } from './playerStore';

/** Holding the pointer this long without moving points at the spot. */
export const HOLD_MS = 500;
/** Moving farther than this before the hold ends cancels the ping (a pan or pinch). */
export const HOLD_SLOP_PX = 8;

interface PlayerPointerState {
  /** The player's own token while they drag it; `to` is snapped. */
  drag: { combatantId: string; from: MapPoint; to: MapPoint } | null;
}

export const usePlayerPointer = create<PlayerPointerState>(() => ({ drag: null }));

let hold: { timer: number; x: number; y: number } | null = null;

/** Stops a pending ping, e.g. when a second finger touches or the pointer moved away. */
export function cancelHold(): void {
  if (hold) window.clearTimeout(hold.timer);
  hold = null;
}

/** Screen position of a pointer press; a later move beyond `HOLD_SLOP_PX` from it cancels the hold. */
export function pointerMoved(x: number, y: number): void {
  if (hold && Math.hypot(x - hold.x, y - hold.y) > HOLD_SLOP_PX) cancelHold();
}

/** Snapped centre for the dragged token, keeping its height above the ground like the DM's drag. */
function snapDrag(combatantId: string, point: MapPoint, from: MapPoint): MapPoint | null {
  const { map, terrain, encounter } = usePlayerStore.getState();
  const combatant = encounter?.combatants.find((c) => c.id === combatantId);
  const snapped = combatant && map && terrain && snapTokenPoint(point, combatant.size, map.grid, terrain);
  return snapped && terrain
    ? { ...snapped, elevationFt: snapped.elevationFt + from.elevationFt - terrain.sample(from.x, from.y) }
    : null;
}

/**
 * Map input of the player page: holding the pointer still pings the spot; while the DM allows it, the
 * player's own token is dragged and the drop is sent as a move request. `screen` is the press position in
 * screen pixels.
 */
export function playerPointer(
  event: MapPointerEvent,
  screen: { x: number; y: number },
  send: (payload: SyncPayload) => void,
): void {
  const { encounter } = usePlayerStore.getState();
  const { drag } = usePlayerPointer.getState();
  const own = encounter?.ownMoves && encounter.sheet ? encounter.sheet.id : null;
  const token = own && event.hit?.kind === 'token' && event.hit.id === own;
  const from = token ? encounter?.combatants.find((c) => c.id === own)?.position : null;
  const press = event.type === 'down' && event.button === 0 && event.point;
  if (press && own && from) {
    cancelHold();
    usePlayerPointer.setState({ drag: { combatantId: own, from, to: from } });
  } else if (press) {
    const at = press;
    cancelHold();
    hold = { timer: window.setTimeout(() => send({ type: 'point', at }), HOLD_MS), x: screen.x, y: screen.y };
  } else if (event.type === 'move' && event.point && drag) {
    const to = snapDrag(drag.combatantId, event.point, drag.from);
    if (to) usePlayerPointer.setState({ drag: { ...drag, to } });
  } else if (event.type === 'up') {
    cancelHold();
    const moved = drag && (drag.from.x !== drag.to.x || drag.from.y !== drag.to.y);
    if (drag && moved) send({ type: 'move', combatantId: drag.combatantId, to: drag.to });
    usePlayerPointer.setState({ drag: null });
  }
}
