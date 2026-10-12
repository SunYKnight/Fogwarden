import type { ComponentType } from 'react';
import { PlayerViewPanel } from './PlayerViewPanel';

/** Extra side panels of the encounter page (fog and player camera); modules append theirs here. */
export const ENCOUNTER_PANELS: { id: string; label: string; Component: ComponentType }[] = [
  { id: 'player-view', label: 'Player view', Component: PlayerViewPanel },
];
