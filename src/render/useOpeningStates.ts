import { useMemo } from 'react';
import type { OpeningState } from '@/core/model';
import { useEncounterStore } from '@/state/encounterStore';
import { usePlayerStore } from '@/ui/player/playerStore';
import { useMapRender } from './mapRenderContext';

/**
 * Live door state of every opening of the rendered map: the map's states, overridden during play
 * by the encounter's (DM) or the received player encounter's states.
 */
export function useOpeningStates(): Record<string, OpeningState> {
  const { map, mode } = useMapRender();
  const dmStates = useEncounterStore((s) => s.encounter?.openingStates);
  const playerStates = usePlayerStore((s) => s.encounter?.openingStates);
  const live = mode === 'dm' ? dmStates : mode === 'player' ? playerStates : undefined;
  return useMemo(
    () => ({ ...Object.fromEntries(map.openings.map((o) => [o.id, o.state])), ...live }),
    [map.openings, live],
  );
}
