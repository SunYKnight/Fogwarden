import type { ComponentType } from 'react';
import { PlayerViewPanel } from './PlayerViewPanel';
import { LanPanel } from './LanPanel';

/** Extra side panels of the encounter page (player view, fog, LAN); modules append theirs here. */
export const ENCOUNTER_PANELS: { id: string; label: string; Component: ComponentType }[] = [
  { id: 'player-view', label: 'Player view', Component: PlayerViewPanel },
  { id: 'lan', label: 'LAN players', Component: LanPanel },
];
