import { create } from 'zustand';
import type { MapPoint, MarkerTemplate } from '@/core/model';
import type { RollMode } from '@/core/rules/dice';
import type { CameraMode } from '@/render/CameraRig';
import type { HitTag } from '@/render/mapRenderContext';
import { useFogViewStore } from '@/render/fog/fogViewStore';

export type EncounterTool = 'select' | 'measure';
export type InspectorTab = 'encounter' | 'table' | 'dice' | 'log' | 'chat' | 'areas';
export type DockTab = 'actions' | 'effects' | 'token' | 'stats' | 'notes';
export type HpChange = 'damage' | 'heal' | 'temp';

/** Transient interaction state of the encounter page; nothing here is saved. */
interface EncounterUiState {
  tool: EncounterTool;
  camera: CameraMode;
  /** Advantage mode used by the dice roller and attack buttons. */
  rollMode: RollMode;
  /** Last pointer position on the map while placing something. */
  pointer: MapPoint | null;
  /** Token or door under the pointer; it glows and the cursor turns into a hand. */
  hover: HitTag | null;
  drag: { combatantId: string; from: MapPoint; to: MapPoint } | null;
  /** Combatant waiting for a click on the map. */
  placingId: string | null;
  /** Placing continues with the next unplaced combatant after each click. */
  placingAll: boolean;
  measure: { from: MapPoint; to: MapPoint; active: boolean } | null;
  /** Area marker being placed: origin set by the first click, aimed at the pointer. */
  placement: { template: MarkerTemplate; origin: MapPoint | null } | null;
  inspectorTab: InspectorTab;
  /** Tab of the creature dock; it stays when another creature is shown. */
  dockTab: DockTab;
  /** Creature dock reduced to one line, giving the map more height. */
  dockCollapsed: boolean;
  fogMenuOpen: boolean;
  addDialogOpen: boolean;
  /** Damage or heal amount asked for from the token context menu. */
  hpPrompt: { combatantId: string; change: HpChange } | null;
  /** Concentration saves owed after damage, oldest first. */
  concentrationChecks: { combatantId: string; dc: number }[];
  endCombatOpen: boolean;
  mapDialogOpen: boolean;
  /** Placed area whose targets the Areas tab lists. */
  areaTargetsId: string | null;
}

export const useEncounterUi = create<EncounterUiState>(() => ({
  tool: 'select',
  camera: 'top',
  rollMode: 'normal',
  pointer: null,
  hover: null,
  drag: null,
  placingId: null,
  placingAll: false,
  measure: null,
  placement: null,
  inspectorTab: 'encounter',
  dockTab: 'actions',
  dockCollapsed: false,
  fogMenuOpen: false,
  addDialogOpen: false,
  hpPrompt: null,
  concentrationChecks: [],
  endCombatOpen: false,
  mapDialogOpen: false,
  areaTargetsId: null,
}));

/** Drops whatever is being placed, dragged or measured; true when something was. */
export function cancelInteraction(): boolean {
  const { drag, placingId, measure, placement } = useEncounterUi.getState();
  const busy = drag !== null || placingId !== null || measure !== null || placement !== null;
  useEncounterUi.setState({
    pointer: null,
    drag: null,
    placingId: null,
    placingAll: false,
    measure: null,
    placement: null,
  });
  return busy;
}

/** Arms token placement; `all` continues with the next unplaced combatant after each click. */
export function startPlacing(combatantId: string, all: boolean): void {
  useFogViewStore.getState().setBrush('off');
  useEncounterUi.setState({ placingId: combatantId, placingAll: all, placement: null, measure: null, tool: 'select' });
}

/** Waits for the origin click of an area marker from `template`. */
export function startAreaPlacement(template: MarkerTemplate): void {
  useFogViewStore.getState().setBrush('off');
  useEncounterUi.setState({
    placement: { template, origin: null },
    placingId: null,
    placingAll: false,
    measure: null,
    tool: 'select',
  });
}

/** Pointer tools and the fog brush exclude each other. */
export function chooseTool(tool: EncounterTool): void {
  useFogViewStore.getState().setBrush('off');
  useEncounterUi.setState({ tool, measure: null, drag: null });
}

/** Queues the concentration saves `owed` (DC by combatant id) asks for. */
export function queueConcentrationChecks(owed: Record<string, number>): void {
  const checks = Object.entries(owed).map(([combatantId, dc]) => ({ combatantId, dc }));
  if (checks.length > 0)
    useEncounterUi.setState((s) => ({ concentrationChecks: [...s.concentrationChecks, ...checks] }));
}
