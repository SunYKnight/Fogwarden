import { useEffect, useMemo, type DependencyList } from 'react';
import type { MapLight, MapPoint } from '@/core/model';
import { useEditorStore, type LayerId } from '@/state/editorStore';
import { useEncounterStore } from '@/state/encounterStore';
import { usePlayerStore } from '@/ui/player/playerStore';
import { useMapRender } from '../mapRenderContext';

/**
 * Memoized three.js resource that is disposed when its inputs change or the component unmounts.
 * `deps` may list inputs `create` reads indirectly, e.g. a terrain version for a mutated height field.
 * `create` returns null when nothing is rendered, so no resource is built.
 */
export function useDisposable<T extends { dispose(): void } | null>(create: () => T, deps: DependencyList): T {
  // Callers pass what `create` reads; the lint rule cannot see that.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(create, deps);
  useEffect(() => () => value?.dispose(), [value]);
  return value;
}

/** Editor layer toggles hide content in the editor only; play views always show every layer. */
export function useLayerVisible(layer: LayerId): boolean {
  const { mode } = useMapRender();
  const on = useEditorStore((s) => s.layers[layer]);
  return mode !== 'editor' || on;
}

/** Positions of placed combatants by id, from the encounter (DM) or what the player view received. */
export function useCombatantPositions(): Record<string, MapPoint> {
  const { mode } = useMapRender();
  const dm = useEncounterStore((s) => s.encounter?.combatants);
  const player = usePlayerStore((s) => s.encounter?.combatants);
  const combatants = mode === 'dm' ? dm : mode === 'player' ? player : undefined;
  return useMemo(
    () =>
      Object.fromEntries(
        (combatants ?? []).flatMap((c) => (c.position ? [[c.id, c.position] as [string, MapPoint]] : [])),
      ),
    [combatants],
  );
}

/** Lights placed combatants carry, as map lights attached to them; none in the editor. */
export function useCarriedLights(): MapLight[] {
  const { mode } = useMapRender();
  const dm = useEncounterStore((s) => s.encounter?.combatants);
  const player = usePlayerStore((s) => s.encounter?.combatants);
  const combatants = mode === 'dm' ? dm : mode === 'player' ? player : undefined;
  return useMemo(
    () =>
      (combatants ?? []).flatMap(({ id, light, position }) =>
        light && position ? [{ ...light, id: `carried-${id}`, position, enabled: true, attachedTo: id }] : [],
      ),
    [combatants],
  );
}

/** Raycast stub for previews and helpers that must never catch pointer events. */
export function noRaycast(): void {}
