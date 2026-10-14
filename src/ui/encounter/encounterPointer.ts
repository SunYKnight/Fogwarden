import { newId, type AreaMarker, type AreaShape, type MapPoint, type OpeningState } from '@/core/model';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { snapTokenPoint } from '@/render/tokens/tokenPlacement';
import { addLog, currentCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useEncounterUi } from './encounterUiStore';

/** Shapes measured from their centre; they need no aiming click. */
const RADIAL: Record<AreaShape, boolean> = { cone: false, cube: false, cylinder: true, line: false, sphere: true };

const OPENING_VERB: Record<OpeningState, string> = { open: 'opened', closed: 'closed', locked: 'locked' };
const CLICK_NEXT: Record<OpeningState, OpeningState> = { open: 'closed', closed: 'open', locked: 'locked' };
const SHIFT_NEXT: Record<OpeningState, OpeningState> = { open: 'locked', closed: 'locked', locked: 'closed' };

/** 0° = east, 90° = south (map plane y points south). */
export function directionDeg(from: MapPoint, to: MapPoint): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** Snapped token centre; a flying token dragged from `from` keeps its height above the ground. */
function snapFor(combatantId: string, point: MapPoint, from: MapPoint | null): MapPoint | null {
  const { encounter, map, terrain } = useEncounterStore.getState();
  const combatant = encounter?.combatants.find((c) => c.id === combatantId);
  const snapped = combatant && map && terrain && snapTokenPoint(point, combatant.size, map.grid, terrain);
  const aboveGround = from && terrain ? from.elevationFt - terrain.sample(from.x, from.y) : 0;
  return snapped ? { ...snapped, elevationFt: snapped.elevationFt + aboveGround } : null;
}

/** Click toggles open/closed; Shift+click locks or unlocks. Locked doors don't open with a plain click. */
function toggleOpening(id: string, lockToggle: boolean): void {
  const { encounter, map, update } = useEncounterStore.getState();
  const opening = map?.openings.find((o) => o.id === id);
  const state = opening && (encounter?.openingStates[id] ?? opening.state);
  const next = state && (lockToggle ? SHIFT_NEXT : CLICK_NEXT)[state];
  if (opening && next && next !== state) {
    update((d) => {
      d.openingStates[id] = next;
      addLog(d, 'note', `${opening.kind} ${OPENING_VERB[next]}`);
    }, `${opening.kind} ${OPENING_VERB[next]}`);
  }
}

function placeMarker(point: MapPoint): void {
  const { placement } = useEncounterUi.getState();
  if (placement && (placement.origin || RADIAL[placement.template.shape])) {
    const { template } = placement;
    const origin = placement.origin ?? point;
    const marker: AreaMarker = {
      id: newId(),
      templateId: template.id,
      label: template.name,
      shape: template.shape,
      sizeFt: template.sizeFt,
      widthFt: template.widthFt,
      heightFt: template.heightFt,
      origin,
      directionDeg: placement.origin ? directionDeg(origin, point) : 0,
      color: template.color,
      opacity: template.opacity,
      visibleToPlayers: true,
      save: template.save,
    };
    useEncounterStore.getState().update((d) => {
      d.markers.push(marker);
      addLog(d, 'note', `${template.name} placed`);
    }, `Place ${template.name}`);
    // The Areas tab then lists who is inside, ready for saves and damage.
    useEncounterUi.setState({ placement: null, pointer: null, areaTargetsId: marker.id, inspectorTab: 'areas' });
  } else if (placement) {
    useEncounterUi.setState({ placement: { ...placement, origin: point } });
  }
}

/** Puts the placing combatant down; when placing all, the next unplaced one follows. */
function placeToken(id: string, point: MapPoint): void {
  const store = useEncounterStore.getState();
  const placed = snapFor(id, point, null);
  const name = store.encounter?.combatants.find((c) => c.id === id)?.name;
  if (placed) {
    store.update((d) => {
      d.combatants.find((c) => c.id === id)!.position = placed;
      // Placed during its own turn: that is where its movement starts.
      if (currentCombatant(d)?.id === id && d.turnStart === null) d.turnStart = { ...placed };
    }, `Place ${name}`);
  }
  const next = useEncounterUi.getState().placingAll
    ? useEncounterStore.getState().encounter?.combatants.find((c) => c.position === null && c.id !== id)
    : undefined;
  useEncounterUi.setState({ placingId: next?.id ?? null, placingAll: next !== undefined });
}

function selectPointer(event: MapPointerEvent): void {
  const ui = useEncounterUi.getState();
  const store = useEncounterStore.getState();
  const { point, hit } = event;
  const primaryDown = event.type === 'down' && event.button === 0 && point;
  const token = hit?.kind === 'token' ? store.encounter?.combatants.find((c) => c.id === hit.id) : undefined;
  if (primaryDown && ui.placingId) {
    placeToken(ui.placingId, point);
  } else if (primaryDown && token) {
    store.select(token.id);
    if (token.position)
      useEncounterUi.setState({ drag: { combatantId: token.id, from: token.position, to: token.position } });
  } else if (primaryDown && hit?.kind === 'opening') {
    toggleOpening(hit.id, event.shiftKey);
  } else if (primaryDown) {
    store.select(null);
  } else if (event.type === 'move' && point && ui.drag) {
    const to = snapFor(ui.drag.combatantId, point, ui.drag.from);
    if (to) useEncounterUi.setState({ drag: { ...ui.drag, to } });
  } else if (event.type === 'move' && point && ui.placingId) {
    useEncounterUi.setState({ pointer: point });
  } else if (event.type === 'up' && ui.drag) {
    const { combatantId, from, to } = ui.drag;
    const name = store.encounter?.combatants.find((c) => c.id === combatantId)?.name;
    if (from.x !== to.x || from.y !== to.y || from.elevationFt !== to.elevationFt) {
      store.update((d) => void (d.combatants.find((c) => c.id === combatantId)!.position = to), `Move ${name}`);
    }
    useEncounterUi.setState({ drag: null });
  }
}

function measurePointer(event: MapPointerEvent): void {
  const { measure } = useEncounterUi.getState();
  if (event.type === 'down' && event.button === 0 && event.point) {
    useEncounterUi.setState({ measure: { from: event.point, to: event.point, active: true } });
  } else if (event.type === 'move' && event.point && measure?.active) {
    useEncounterUi.setState({ measure: { ...measure, to: event.point } });
  } else if (event.type === 'up' && measure?.active) {
    useEncounterUi.setState({ measure: { ...measure, active: false } });
  }
}

/** Routes map pointer events of the encounter view to marker placement, the ruler or token handling. */
export function handleEncounterPointer(event: MapPointerEvent): void {
  const ui = useEncounterUi.getState();
  // Until the origin is set the preview follows the square the area will
  // start from; afterwards the raw pointer aims it.
  const aim = ui.placement && event.point && (ui.placement.origin ? event.point : squareCentre(event.point));
  if (ui.placement && event.type === 'down' && event.button === 0 && aim) {
    placeMarker(aim);
  } else if (ui.placement && event.type === 'move' && aim) {
    useEncounterUi.setState({ pointer: aim });
  } else if (!ui.placement && ui.tool === 'measure') {
    measurePointer(event);
  } else if (!ui.placement) {
    selectPointer(event);
  }
}

/** Centre of the grid square under `point`, on the ground; areas start there. */
function squareCentre(point: MapPoint): MapPoint {
  const { map, terrain } = useEncounterStore.getState();
  return map && terrain ? snapTokenPoint(point, 'medium', map.grid, terrain) : point;
}
