import { applyPatches, enablePatches, produceWithPatches, type Draft } from 'immer';
import { create } from 'zustand';
import type { BattleMap, MapPoint } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import type { EditorStep } from '@/editor/tool';
import type { CameraMode } from '@/render/CameraRig';
import type { HitTag } from '@/render/mapRenderContext';
import { History, type HistoryEntry } from './history';

enablePatches();

export type LayerId = 'image' | 'grid' | 'terrain' | 'walls' | 'rooms' | 'roofs' | 'regions' | 'lights' | 'props';

export const LAYERS: LayerId[] = ['image', 'grid', 'terrain', 'walls', 'rooms', 'roofs', 'regions', 'lights', 'props'];

export type MapSettingsTab = 'map' | 'grid' | 'lighting';

export type Selection = {
  kind: 'wall' | 'opening' | 'room' | 'region' | 'light' | 'prop';
  id: string;
  vertex: number | null;
} | null;

interface EditorState {
  /** Map document; `terrain.heights` is stale while editing, the live heights are in `terrain`. */
  map: BattleMap | null;
  terrain: HeightField | null;
  /** Incremented on every terrain change so meshes rebuild without deep comparisons. */
  terrainVersion: number;
  /** Incremented on every document change; autosave watches it. */
  revision: number;
  savedRevision: number;
  history: History;
  canUndo: boolean;
  canRedo: boolean;
  activeTool: string;
  /** Step tab shown in the tool bar. */
  step: EditorStep;
  selection: Selection;
  /** Steps whose first-visit hint was dismissed or left; kept across maps for the session. */
  helpSeen: Record<EditorStep, boolean>;
  /** Object a click of the select tool would select, highlighted on the map. */
  hover: HitTag | null;
  /** Map point under the pointer, for the status bar readouts. */
  pointer: MapPoint | null;
  settingsOpen: boolean;
  /** Kept while the dialog is closed, so a grid pick returns to the Grid tab. */
  settingsTab: MapSettingsTab;
  exportOpen: boolean;
  layers: Record<LayerId, boolean>;
  camera: CameraMode;
  previewAsPlayer: boolean;

  open(map: BattleMap): void;
  close(): void;
  edit(label: string, recipe: (draft: Draft<BattleMap>) => void): void;
  /** Replaces the height field (e.g. after a resize) as one undoable step. */
  replaceTerrain(label: string, next: HeightField, recipe?: (draft: Draft<BattleMap>) => void): void;
  /** Start of a sculpt stroke: remembers the heights for undo. */
  beginTerrainStroke(): void;
  /** Call after mutating `terrain.data` in place during a stroke. */
  terrainChanged(): void;
  endTerrainStroke(label: string): void;
  undo(): void;
  redo(): void;
  /** Activates a tool; tools of a step also show that step's tab. */
  setTool(id: string, step?: EditorStep): void;
  setStep(step: EditorStep): void;
  select(selection: Selection): void;
  dismissHelp(step: EditorStep): void;
  setHover(hover: HitTag | null): void;
  setPointer(pointer: MapPoint | null): void;
  setSettingsOpen(open: boolean): void;
  setSettingsTab(tab: MapSettingsTab): void;
  setExportOpen(open: boolean): void;
  toggleLayer(id: LayerId): void;
  setCamera(mode: CameraMode): void;
  setPreviewAsPlayer(on: boolean): void;
  /** Document with the live terrain encoded, ready to save. */
  snapshot(): BattleMap;
  markSaved(revision: number): void;
}

let strokeStart: Float32Array | null = null;

function allLayers(): Record<LayerId, boolean> {
  return Object.fromEntries(LAYERS.map((l) => [l, true])) as Record<LayerId, boolean>;
}

// Leaving a step counts as having read its first-visit hint.
function stepChange(s: EditorState, step: EditorStep): Pick<EditorState, 'step' | 'helpSeen'> {
  return { step, helpSeen: step === s.step ? s.helpSeen : { ...s.helpSeen, [s.step]: true } };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  map: null,
  terrain: null,
  terrainVersion: 0,
  revision: 0,
  savedRevision: 0,
  history: new History(),
  canUndo: false,
  canRedo: false,
  activeTool: 'select',
  step: 'ground',
  selection: null,
  helpSeen: { ground: false, walls: false, areas: false, objects: false },
  hover: null,
  pointer: null,
  settingsOpen: false,
  settingsTab: 'map',
  exportOpen: false,
  layers: allLayers(),
  camera: 'top',
  previewAsPlayer: false,

  open: (map) => {
    get().history.clear();
    set({
      map,
      terrain: HeightField.fromMap(map),
      terrainVersion: get().terrainVersion + 1,
      revision: 0,
      savedRevision: 0,
      canUndo: false,
      canRedo: false,
      activeTool: 'select',
      selection: null,
      hover: null,
      pointer: null,
      settingsOpen: false,
      exportOpen: false,
    });
  },

  close: () => {
    get().history.clear();
    set({
      map: null,
      terrain: null,
      selection: null,
      hover: null,
      pointer: null,
      settingsOpen: false,
      exportOpen: false,
      canUndo: false,
      canRedo: false,
    });
  },

  edit: (label, recipe) => {
    const { map, history } = get();
    if (!map) {
      throw new Error('No map is open in the editor');
    }
    const [next, patches, inverse] = produceWithPatches(map, recipe);
    if (patches.length > 0) {
      history.push({ kind: 'patches', label, patches, inverse });
      set((s) => ({ map: next, revision: s.revision + 1, canUndo: true, canRedo: false }));
    }
  },

  replaceTerrain: (label, next, recipe) => {
    const { map, terrain, history } = get();
    if (!map || !terrain) {
      throw new Error('No map is open in the editor');
    }
    // Strokes leave stored heights stale; undo must restore the live ones.
    const synced = { ...map, terrain: { ...map.terrain, heights: terrain.encode() } };
    const [nextMap, patches, inverse] = produceWithPatches(synced, (draft) => {
      recipe?.(draft);
      draft.terrain.heights = next.encode();
    });
    history.push({ kind: 'patches', label, patches, inverse });
    set((s) => ({
      map: nextMap,
      terrain: next,
      terrainVersion: s.terrainVersion + 1,
      revision: s.revision + 1,
      canUndo: true,
      canRedo: false,
    }));
  },

  beginTerrainStroke: () => {
    strokeStart = get().terrain?.data.slice() ?? null;
  },

  terrainChanged: () => set((s) => ({ terrainVersion: s.terrainVersion + 1 })),

  endTerrainStroke: (label) => {
    const { terrain, history } = get();
    if (terrain && strokeStart) {
      history.push({ kind: 'terrain', label, before: strokeStart, after: terrain.data.slice() });
      set((s) => ({ revision: s.revision + 1, canUndo: true, canRedo: false }));
    }
    strokeStart = null;
  },

  undo: () => applyHistoryEntry(get().history.takeUndo(), 'undo'),
  redo: () => applyHistoryEntry(get().history.takeRedo(), 'redo'),

  setTool: (id, step) =>
    set((s) => (step ? { activeTool: id, hover: null, ...stepChange(s, step) } : { activeTool: id, hover: null })),
  setStep: (step) => set((s) => stepChange(s, step)),
  select: (selection) => set({ selection }),
  dismissHelp: (step) => set((s) => ({ helpSeen: { ...s.helpSeen, [step]: true } })),
  // Pointer moves repeat the same target; unchanged hovers must not re-render.
  setHover: (hover) => {
    const current = get().hover;
    if (current?.kind !== hover?.kind || current?.id !== hover?.id) set({ hover });
  },
  setPointer: (pointer) => set({ pointer }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  setCamera: (camera) => set({ camera }),
  setPreviewAsPlayer: (previewAsPlayer) => set({ previewAsPlayer }),

  snapshot: () => {
    const { map, terrain } = get();
    if (!map || !terrain) {
      throw new Error('No map is open in the editor');
    }
    return { ...map, terrain: { ...map.terrain, heights: terrain.encode() } };
  },

  markSaved: (revision) => set({ savedRevision: revision }),
}));

function applyHistoryEntry(entry: HistoryEntry | undefined, direction: 'undo' | 'redo'): void {
  const { history, map, terrain } = useEditorStore.getState();
  if (entry && map && terrain) {
    if (entry.kind === 'patches') {
      const nextMap = applyPatches(map, direction === 'undo' ? entry.inverse : entry.patches);
      const terrainSwapped = nextMap.terrain.heights !== map.terrain.heights;
      useEditorStore.setState((s) => ({
        map: nextMap,
        terrain: terrainSwapped ? HeightField.fromMap(nextMap) : terrain,
        terrainVersion: s.terrainVersion + (terrainSwapped ? 1 : 0),
      }));
    } else {
      terrain.data.set(direction === 'undo' ? entry.before : entry.after);
      useEditorStore.setState((s) => ({ terrainVersion: s.terrainVersion + 1 }));
    }
    useEditorStore.setState((s) => ({
      revision: s.revision + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }));
  }
}
