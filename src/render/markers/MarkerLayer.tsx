import { useEncounterStore } from '@/state/encounterStore';
import { usePlayerStore } from '@/ui/player/playerStore';
import { useMapRender } from '../mapRenderContext';
import { MarkerShape } from './MarkerShape';

function DmMarkers() {
  const markers = useEncounterStore((s) => s.encounter?.markers);
  return markers?.map((m) => <MarkerShape key={m.id} marker={m} />);
}

function PlayerMarkers() {
  const markers = usePlayerStore((s) => s.encounter?.markers);
  return markers?.map((m) => <MarkerShape key={m.id} marker={m} />);
}

/** Area markers of the encounter; players get only the markers the DM sent them. */
export function MarkerLayer() {
  const { mode } = useMapRender();
  return mode === 'dm' ? <DmMarkers /> : mode === 'player' ? <PlayerMarkers /> : null;
}
