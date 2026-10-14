import type { BitSet } from '@/core/binary';
import { sceneLightLevel } from '@/core/atmosphere/timeOfDay';
import type { BattleMap, Encounter, Fog, LightLevel } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { exploreBySource, fogSize, readEncounterFog, readFogBits, viewFog, type FogSources } from '@/core/vision/fog';
import type { VisionState } from '@/core/vision/visibility';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { useCalendarStore } from '@/state/calendarStore';
import { useEncounterStore } from '@/state/encounterStore';
import { currentDmScene } from '@/state/scene';
import type { VisibilityRequest, VisibilityResponse } from '@/workers/visibilityProtocol';

// Explored cells change with every token step; the document needn't.
const PERSIST_INTERVAL_MS = 1000;

function visionState(encounter: Encounter): VisionState {
  return {
    openingStates: encounter.openingStates,
    combatants: encounter.combatants.map(({ id, position, size, senses, visionSource, light }) => ({
      id,
      position,
      size,
      senses,
      visionSource,
      light,
    })),
    cellsPerSquare: encounter.fog.cellsPerSquare,
  };
}

/**
 * Keeps the open encounter's fog up to date: visibility runs in a worker whenever tokens, doors, senses
 * or the map change (a burst of changes collapses into the latest request), each vision source's result is
 * merged into its own explored cells, the party's fog (all sources with the DM overrides) goes to
 * `useFogViewStore.fog` and the per-source parts to `useFogViewStore.sources`, and newly explored cells are
 * written back to `encounter.fog.exploredBy` at most once per second.
 */
export function startFogTracker(): () => void {
  const worker = new Worker(new URL('../workers/visibility.worker.ts', import.meta.url), { type: 'module' });
  const reportError = (error: unknown) => useAppStore.getState().reportError(error);
  let scene: { map: BattleMap; terrain: HeightField; ambientLight: LightLevel } | null = null;
  let requested = '';
  let nextId = 1;
  let inFlight: { id: number; key: string } | null = null;
  let pending: { key: string; state: VisionState } | null = null;
  let visible: { key: string; cells: Map<string, Uint8Array>; ms: number } | null = null;
  // Explored cells per source of `exploredKey`, ahead of the document until
  // persisted; `written` is the document's record they were read from.
  let explored = new Map<string, BitSet>();
  let exploredKey = '';
  let written: Fog['exploredBy'] | null = null;
  let persistTimer: number | undefined;
  let lastPersist = 0;
  let composed: { visible: unknown; fog: unknown; key: string } = { visible: null, fog: null, key: '' };

  const compute = (key: string, state: VisionState) => {
    if (inFlight) {
      pending = { key, state };
    } else {
      inFlight = { id: nextId++, key };
      worker.postMessage({ type: 'compute', id: inFlight.id, state } satisfies VisibilityRequest);
    }
  };

  const persist = () => {
    persistTimer = undefined;
    const { encounter } = useEncounterStore.getState();
    if (encounter && exploredKey.startsWith(`${encounter.id}:`)) {
      const value = Object.fromEntries([...explored].map(([id, bits]) => [id, bits.toBase64()]));
      written = value;
      lastPersist = performance.now();
      useEncounterStore.getState().update((draft) => {
        draft.fog.exploredBy = value;
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
    const key = encounter && map && size ? `${encounter.id}:${map.id}:${size.cellsX}x${size.cellsY}` : '';
    if (encounter && size && (key !== exploredKey || encounter.fog.exploredBy !== written)) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
      const stored = Object.entries(encounter.fog.exploredBy);
      explored = new Map(stored.map(([id, bits]) => [id, readFogBits(bits, size.cellsX * size.cellsY)]));
      exploredKey = key;
      written = encounter.fog.exploredBy;
    }
    const inputsChanged = composed.visible !== visible || composed.fog !== encounter?.fog || composed.key !== key;
    composed = { visible, fog: encounter?.fog, key };
    if (inputsChanged && encounter && size && visible?.key.startsWith(`${key}|`)) {
      const { revealed, hidden } = readEncounterFog(encounter.fog, size);
      if (exploreBySource(explored, visible.cells, hidden)) {
        schedulePersist();
      }
      const sources: FogSources = { size, visible: visible.cells, explored, revealed, hidden };
      const party = new Set([...visible.cells.keys(), ...explored.keys()]);
      useFogViewStore.getState().setFog(viewFog(sources, party), sources, visible.ms);
    } else if (inputsChanged) {
      useFogViewStore.getState().setFog(null, null, null);
    }
  };

  const update = () => {
    const { encounter, map, terrain } = useEncounterStore.getState();
    if (encounter && map && terrain) {
      // The scene's time of day darkens open maps for every vision source.
      const ambientLight = sceneLightLevel(currentDmScene()?.minute ?? null, map.ambientLight);
      if (scene?.map !== map || scene.terrain !== terrain || scene.ambientLight !== ambientLight) {
        scene = { map, terrain, ambientLight };
        requested = '';
        const { grid, walls, openings, rooms, regions, lights } = map;
        worker.postMessage({
          type: 'scene',
          map: { grid, walls, openings, rooms, regions, lights, ambientLight },
          terrain: { cols: terrain.cols, rows: terrain.rows, spacingFt: terrain.spacingFt, data: terrain.data },
        } satisfies VisibilityRequest);
      }
      const state = visionState(encounter);
      const size = fogSize(map.grid, state.cellsPerSquare);
      // Explored-key prefix: other encounters', maps' or sizes' results
      // never apply.
      const key = `${encounter.id}:${map.id}:${size.cellsX}x${size.cellsY}|${JSON.stringify(state)}`;
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

  const unsubscribers = [useEncounterStore.subscribe(update), useCalendarStore.subscribe(update)];
  update();

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer);
      persist();
    }
    worker.terminate();
    useFogViewStore.getState().setFog(null, null, null);
  };
}
