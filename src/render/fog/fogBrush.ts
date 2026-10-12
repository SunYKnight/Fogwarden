import type { MapPoint } from '@/core/model';
import { fogSize, paintFogCircle, readFogBits } from '@/core/vision/fog';
import { useEncounterStore } from '@/state/encounterStore';
import type { MapPointerEvent } from '../mapRenderContext';
import { useFogViewStore } from './fogViewStore';

let painting = false;

function paint(point: MapPoint): void {
  const { encounter, map } = useEncounterStore.getState();
  const { brush, brushRadiusFt } = useFogViewStore.getState();
  if (encounter && map) {
    const size = fogSize(map.grid, encounter.fog.cellsPerSquare);
    const count = size.cellsX * size.cellsY;
    const revealed = readFogBits(encounter.fog.revealedByDm, count);
    const hidden = readFogBits(encounter.fog.hiddenByDm, count);
    paintFogCircle(revealed, point, brushRadiusFt, size, brush === 'reveal');
    paintFogCircle(hidden, point, brushRadiusFt, size, brush === 'hide');
    useEncounterStore.getState().update((draft) => {
      draft.fog.revealedByDm = revealed.toBase64();
      draft.fog.hiddenByDm = hidden.toBase64();
    });
  }
}

/**
 * Pointer handling of the DM's fog brush on the encounter map: left drag reveals, hides or erases DM
 * overrides in a circle. Returns true when the brush is active and took the event.
 */
export function fogBrushPointer(event: MapPointerEvent): boolean {
  const active = useFogViewStore.getState().brush !== 'off';
  if (active && event.type !== 'up' && event.point) {
    useFogViewStore.getState().setCursor(event.point);
  }
  if (active && event.type === 'down' && event.button === 0) {
    painting = true;
  }
  if (painting && event.type !== 'up' && event.point) {
    paint(event.point);
  }
  if (event.type === 'up') {
    painting = false;
  }
  return active && (event.button === 0 || event.type === 'move');
}
