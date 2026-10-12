import { create } from 'zustand';
import type { MapPoint, MarkerTemplate } from '@/core/model';
import type { CameraMode } from '@/render/CameraRig';
import type { RollMode } from '@/core/rules/dice';

export type EncounterTool = 'select' | 'measure';

/** Transient interaction state of the encounter page; nothing here is saved. */
interface EncounterUiState {
  tool: EncounterTool;
  camera: CameraMode;
  /** Advantage mode used by the dice roller and attack buttons. */
  rollMode: RollMode;
  /** Last pointer position on the map while placing something. */
  pointer: MapPoint | null;
  drag: { combatantId: string; from: MapPoint; to: MapPoint } | null;
  /** Combatant from the tray waiting for a click on the map. */
  placingId: string | null;
  measure: { from: MapPoint; to: MapPoint; active: boolean } | null;
  /** Area marker being placed: origin set by the first click, aimed at the pointer. */
  placement: { template: MarkerTemplate; origin: MapPoint | null } | null;
}

export const useEncounterUi = create<EncounterUiState>(() => ({
  tool: 'select',
  camera: 'top',
  rollMode: 'normal',
  pointer: null,
  drag: null,
  placingId: null,
  measure: null,
  placement: null,
}));

/** Esc: drops whatever is being placed, dragged or measured. */
export function cancelInteraction(): void {
  useEncounterUi.setState({ pointer: null, drag: null, placingId: null, measure: null, placement: null });
}
