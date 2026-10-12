import type { BitSet } from '@/core/binary';
import type { BattleMap, Encounter } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { accumulateExplored, composeFog, fogSize, readEncounterFog, readFogBits } from '@/core/vision/fog';
import type { VisionState } from '@/core/vision/visibility';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import type { VisibilityRequest, VisibilityResponse } from '@/workers/visibilityProtocol';

// Explored cells change with every token step; the document needn't.
const PERSIST_INTERVAL_MS = 1000;

function visionState(encounter: Encounter): VisionState {
  return {
    openingStates: encounter.openingStates,
    combatants: encounter.combatants.map(({ id, position, size, senses, visionSource }) => ({
      id,
      position,
      size,
      senses,
      visionSource,
    })),
    cellsPerSquare: encounter.fog.cellsPerSquare,
  };
}

/**
 * Keeps the open encounter's fog up to date: visibility runs in a worker whenever tokens, doors, senses
 * or the map change (a burst of changes collapses into the latest request), the result is merged with
 * the stored explored cells and DM overrides into `useFogViewStore.fog`, and newly explored cells are
 * written back to `encounter.fog.explored` at most once per second.
 */
export function startFogTracker(): () => void {
  const worker = new Worker(new URL('../workers/visibility.worker.ts', import.meta.url), { type: 'module' });
  const reportError = (error: unknown) => useAppStore.getState().reportError(error);
  let scene: { map: BattleMap; terrain: HeightField } | null = null;
  let requested = '';
  let nextId = 1;
  let inFlight: { id: number; key: string } | null = null;
  let pending: { key: string; state: VisionState } | null = null;
  let visible: { key: string; cells: Uint8Array; ms: number } | null = null;
  // Explored cells of `exploredKey`, ahead of the document until persisted.
  let explored: BitSet | null = null;
  let exploredKey = '';
  let written = '';
  let persistTimer: number | undefined;
  let lastPersist = 0;
  let composed: { visible: unknown; fog: unknown; key: string } = { visible: null, fog: null, key: '' };

  const post = (request: VisibilityRequest) => worker.postMessage(request);

  const compute = (key: string, state: VisionState) => {
    if (inFlight) {
      pending = { key, state };
    } else {
      inFlight = { id: nextId++, key };
      post({ type: 'compute', id: inFlight.id, state });
    }
  };

  const persist = () => {
    persistTimer = undefined;
    const { encounter } = useEncounterStore.getState();
    if (explored && encounter && exploredKey.startsWith(`${encounter.id}:`)) {
      const value = explored.toBase64();
      written = value;
      lastPersist = performance.now();
      useEncounterStore.getState().update((draft) => {
        draft.fog.explored = value;
      });
    }
  };

  const schedulePersist = () => {
    if (persistTimer === undefined) {
      persistTimer = window.setTimeout(persist, Math.max(0, lastPersist + PERSIST_INTERVAL_MS - performance.now()));
    }
  };

  const compose = () => {
    const { encounter, map } = useEncounterStore.getState();
    const size = encounter && map ? fogSize(map.grid, encounter.fog.cellsPerSquare) : null;
    const key = encounter && size ? `${encounter.id}:${size.cellsX}x${size.cellsY}` : '';
    if (encounter && size && (key !== exploredKey || encounter.fog.explored !== written)) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
      explored = readFogBits(encounter.fog.explored, size.cellsX * size.cellsY);
      exploredKey = key;
      written = encounter.fog.explored;
    }
    const inputsChanged = composed.visible !== visible || composed.fog !== encounter?.fog || composed.key !== key;
    composed = { visible, fog: encounter?.fog, key };
    if (inputsChanged && encounter && size && explored && visible?.key.startsWith(`${key}|`)) {
      const { revealed, hidden } = readEncounterFog(encounter.fog, size);
      if (accumulateExplored(explored, visible.cells, hidden)) {
        schedulePersist();
      }
      useFogViewStore
        .getState()
        .setFog({ size, cells: composeFog(visible.cells, explored, revealed, hidden) }, visible.ms);
    } else if (inputsChanged) {
      useFogViewStore.getState().setFog(null, null);
    }
  };

  const update = () => {
    const { encounter, map, terrain } = useEncounterStore.getState();
    if (encounter && map && terrain) {
      if (scene?.map !== map || scene.terrain !== terrain) {
        scene = { map, terrain };
        requested = '';
        const { grid, walls, openings, rooms, regions, lights, ambientLight } = map;
        post({
          type: 'scene',
          map: { grid, walls, openings, rooms, regions, lights, ambientLight },
          terrain: { cols: terrain.cols, rows: terrain.rows, spacingFt: terrain.spacingFt, data: terrain.data },
        });
      }
      const state = visionState(encounter);
      const size = fogSize(map.grid, state.cellsPerSquare);
      // Explored-key prefix: other encounters' or sizes' results never apply.
      const key = `${encounter.id}:${size.cellsX}x${size.cellsY}|${JSON.stringify(state)}`;
      if (key !== requested) {
        requested = key;
        compute(key, state);
      }
    } else {
      scene = null;
      requested = '';
    }
    compose();
  };

  worker.onmessage = (event: MessageEvent<VisibilityResponse>) => {
    const response = event.data;
    const finished = inFlight;
    inFlight = null;
    if (response.type === 'error') {
      reportError(new Error(`Visibility failed: ${response.message}`));
    } else if (finished?.id === response.id) {
      visible = { key: finished.key, cells: response.visible, ms: response.ms };
      compose();
    }
    if (pending) {
      const next = pending;
      pending = null;
      compute(next.key, next.state);
    }
  };
  worker.onerror = (event) => reportError(new Error(`Visibility worker: ${event.message}`));

  const unsubscribe = useEncounterStore.subscribe(update);
  update();

  return () => {
    unsubscribe();
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer);
      persist();
    }
    worker.terminate();
    useFogViewStore.getState().setFog(null, null);
  };
}
