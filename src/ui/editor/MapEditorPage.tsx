import { useCallback, useEffect, type ReactNode } from 'react';
import type { BattleMap, DocRef } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { SELECTION_PANELS } from '@/editor/selectionPanels';
import type { EditorStep, EditorTool } from '@/editor/tool';
import { toolById, TOOLS } from '@/editor/tools';
import { SNAP_LABELS, useDraft } from '@/editor/tools/structure/drafting';
import { ModelDropTarget } from '@/editor/tools/structure/propTool';
import { deleteSelection } from '@/editor/tools/structure/selectionPanels';
import { SCENE_LAYERS } from '@/render/layers';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { MapView } from '@/render/MapView';
import { useAppStore } from '@/state/appStore';
import { flushMap } from '@/state/autosave';
import { LAYERS, useEditorStore, type LayerId } from '@/state/editorStore';
import {
  Button,
  openContextMenu,
  PageHeader,
  Popover,
  StatusBar,
  Tabs,
  ToolButton,
  Toolbar,
  useShortcuts,
  type Shortcut,
  type TabSpec,
} from '../kit';
import { MapExportDialog } from '../library/MapExportDialog';
import { MapSettingsDialog } from './MapSettingsDialog';

/** Step tabs in the recommended order of work; the digit keys follow this order. */
const STEP_TABS: TabSpec<EditorStep>[] = [
  { id: 'ground', label: '1 Ground', icon: 'raise' },
  { id: 'walls', label: '2 Walls', icon: 'wall' },
  { id: 'areas', label: '3 Areas', icon: 'room' },
  { id: 'objects', label: '4 Light & objects', icon: 'light' },
];

const STEP_HELP: Record<EditorStep, string> = {
  ground:
    'Shape the terrain under the battlemap: raise hills, dig pits, smooth, flatten, add ramps and terraces. ' +
    'Alt+click picks a height for Flatten. The grid calibration is in Map settings.',
  walls:
    'Trace the walls of the battlemap image with the Wall tool, then put doors and windows on them. ' +
    'Walls block sight, light and movement for the players.',
  areas:
    'Turn closed walls into rooms with floor, ceiling and roof, and mark regions: darkness, difficult terrain, ' +
    'water, hazards or notes for yourself.',
  objects:
    'Place light sources such as torches and lanterns, and 3D props from .glb or .gltf files ' +
    '(or drop the file onto the map).',
};

const LAYER_LABELS: Record<LayerId, string> = {
  image: 'Battlemap image',
  grid: 'Grid',
  terrain: 'Terrain',
  walls: 'Walls and doors',
  rooms: 'Room floors',
  roofs: 'Roofs',
  regions: 'Regions',
  lights: 'Lights',
  props: 'Props',
};

/** Shows a step; a tool of another step gives way to Select so the bar always shows the active tool. */
function showStep(step: EditorStep): void {
  const editor = useEditorStore.getState();
  const tool = toolById(editor.activeTool);
  editor.setStep(step);
  if (tool.step && tool.step !== step) {
    editor.setTool('select');
  }
}

function deleteSelected(): void {
  const { selection } = useEditorStore.getState();
  if (selection) {
    deleteSelection(selection);
  }
}

// Fallback: tools register their own Esc while a drawing is in progress.
function escape(): void {
  const editor = useEditorStore.getState();
  if (editor.selection) {
    editor.select(null);
  } else {
    editor.setTool('select');
  }
}

function toggleCamera(): void {
  const editor = useEditorStore.getState();
  editor.setCamera(editor.camera === 'top' ? 'perspective' : 'top');
}

const EDITOR_SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl+Z', label: 'Undo', run: () => useEditorStore.getState().undo() },
  { keys: 'Ctrl+Y', label: 'Redo', run: () => useEditorStore.getState().redo() },
  { keys: 'Ctrl+Shift+Z', label: 'Redo', run: () => useEditorStore.getState().redo() },
  { keys: 'Delete', label: 'Delete the selection', run: deleteSelected },
  { keys: 'Backspace', label: 'Delete the selection', run: deleteSelected },
  { keys: 'Escape', label: 'Cancel drawing, deselect, then back to Select', run: escape },
  { keys: 'T', label: 'Switch between top view and 3D', run: toggleCamera },
  ...STEP_TABS.map((s, i) => ({ keys: String(i + 1), label: `Step ${s.label}`, run: () => showStep(s.id) })),
  ...TOOLS.flatMap((t) =>
    t.shortcut
      ? [{ keys: t.shortcut.toUpperCase(), label: t.label, run: () => useEditorStore.getState().setTool(t.id, t.step) }]
      : [],
  ),
].map((s: Shortcut) => ({
  ...s,
  run: (event: KeyboardEvent) => {
    try {
      // Keys in the settings or export dialog must not edit the map.
      const { settingsOpen, exportOpen } = useEditorStore.getState();
      if (!settingsOpen && !exportOpen) s.run(event);
    } catch (error) {
      useAppStore.getState().reportError(error);
    }
  },
}));

// Stable identities: the dialog re-focuses its first field when onClose changes.
const closeExport = () => useEditorStore.getState().setExportOpen(false);
// The export shows the map as edited, saved or not.
const loadEditedMap = async () => {
  const { map, terrain } = useEditorStore.getState();
  if (!map || !terrain) {
    throw new Error('No map is open in the editor');
  }
  return { map, terrain };
};

function EditorHeader({ map }: { map: BattleMap }) {
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const camera = useEditorStore((s) => s.camera);
  const preview = useEditorStore((s) => s.previewAsPlayer);
  const saving = useEditorStore((s) => s.revision !== s.savedRevision);
  const { undo, redo, setCamera, setPreviewAsPlayer, setSettingsOpen, setExportOpen } = useEditorStore.getState();
  return (
    <PageHeader
      crumbs={[{ label: 'Maps', route: { page: 'maps' } }, { label: map.name }]}
      status={saving ? 'Saving…' : 'Saved'}
    >
      <Button icon="undo" label="Undo" iconOnly shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo} />
      <Button icon="redo" label="Redo" iconOnly shortcut="Ctrl+Y" disabled={!canRedo} onClick={redo} />
      <Button icon="settings" label="Map settings" onClick={() => setSettingsOpen(true)} />
      <div className="segmented" role="group" aria-label="Camera">
        <Button icon="map" label="Top" shortcut="T" active={camera === 'top'} onClick={() => setCamera('top')} />
        <Button
          icon="cube"
          label="3D"
          shortcut="T"
          active={camera === 'perspective'}
          onClick={() => setCamera('perspective')}
        />
      </div>
      <Button
        icon="eye"
        label="Player look"
        active={preview}
        title="Show the map with the players' lighting"
        onClick={() => setPreviewAsPlayer(!preview)}
      />
      <Button
        icon="more"
        label="More map actions"
        iconOnly
        variant="ghost"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          openContextMenu(box.left, box.bottom + 4, [
            { label: 'Export…', icon: 'download', run: () => setExportOpen(true) },
          ]);
        }}
      />
    </PageHeader>
  );
}

/** Select, the tools of the shown step and the active tool's options in one bar. */
function ToolBar({ tool, step }: { tool: EditorTool; step: EditorStep }) {
  // The active tool stays visible even outside every step (calibration).
  const tools = TOOLS.filter((t) => t.id === 'select' || t.step === step || t.id === tool.id);
  const Options = tool.Panel;
  return (
    <div className="editor-toolbar">
      <Toolbar label="Tools">
        {tools.map((t) => (
          <ToolButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            shortcut={t.shortcut}
            active={t.id === tool.id}
            onClick={() => useEditorStore.getState().setTool(t.id, t.step)}
          />
        ))}
      </Toolbar>
      {Options && (
        <div className="tool-options" role="group" aria-label={`${tool.label} options`}>
          <Options />
        </div>
      )}
    </div>
  );
}

/** Step help on demand; the first visit of a step shows it on the canvas instead. */
function StepHelpButton({ step }: { step: EditorStep }) {
  return (
    <Popover
      label="What to do in this step"
      trigger={(open, toggle) => (
        <Button icon="info" label="What to do in this step" iconOnly variant="ghost" active={open} onClick={toggle} />
      )}
    >
      <p className="editor-step-help">{STEP_HELP[step]}</p>
    </Popover>
  );
}

function StepHint({ step }: { step: EditorStep }) {
  const seen = useEditorStore((s) => s.helpSeen[step]);
  return seen ? null : (
    <div className="editor-step-hint" role="note">
      <p>{STEP_HELP[step]}</p>
      <Button
        icon="close"
        label="Got it"
        iconOnly
        variant="ghost"
        onClick={() => useEditorStore.getState().dismissHelp(step)}
      />
    </div>
  );
}

function LayersButton() {
  const layers = useEditorStore((s) => s.layers);
  const hidden = LAYERS.filter((layer) => !layers[layer]).length;
  return (
    <Popover
      label="Layers"
      trigger={(open, toggle) => (
        <Button icon="eye" label={hidden > 0 ? `Layers (${hidden} hidden)` : 'Layers'} active={open} onClick={toggle} />
      )}
    >
      <div className="editor-layers">
        {LAYERS.map((layer) => (
          <label key={layer} className="row">
            <input
              type="checkbox"
              checked={layers[layer]}
              onChange={() => useEditorStore.getState().toggleLayer(layer)}
            />
            {LAYER_LABELS[layer]}
          </label>
        ))}
      </div>
    </Popover>
  );
}

/** Shown only with a selection, so the canvas takes the full width otherwise. */
function Inspector() {
  const selection = useEditorStore((s) => s.selection);
  const SelectionPanel = selection ? SELECTION_PANELS[selection.kind] : undefined;
  return SelectionPanel && selection ? (
    <aside className="editor-inspector" aria-label="Inspector">
      <SelectionPanel id={selection.id} />
    </aside>
  ) : null;
}

function EditorStatus({ hint, terrain }: { hint?: string; terrain: HeightField }) {
  const pointer = useEditorStore((s) => s.pointer);
  const saving = useEditorStore((s) => s.revision !== s.savedRevision);
  // Subscribed so the height follows sculpting under a still pointer.
  useEditorStore((s) => s.terrainVersion);
  const snap = useDraft((s) => s.cursor?.kind);
  return (
    <StatusBar hint={hint}>
      {pointer && (
        <>
          <span>x {pointer.x.toFixed(1)} ft</span>
          <span>y {pointer.y.toFixed(1)} ft</span>
          <span>h {terrain.sample(pointer.x, pointer.y).toFixed(2)} ft</span>
        </>
      )}
      {snap && <span>{SNAP_LABELS[snap]}</span>}
      <span>{saving ? 'Saving…' : 'Saved'}</span>
    </StatusBar>
  );
}

/** Canvas host; only it re-renders on hover, the passed map view stays untouched. */
function Viewport({ tool, children }: { tool: EditorTool; children: ReactNode }) {
  const hovering = useEditorStore((s) => s.hover !== null);
  const cursor = tool.id === 'select' && hovering ? 'pointer' : (tool.cursor ?? 'default');
  return (
    <div
      className="map-viewport"
      style={{ cursor }}
      onPointerLeave={() => {
        useEditorStore.getState().setPointer(null);
        useEditorStore.getState().setHover(null);
      }}
    >
      {children}
    </div>
  );
}

function EditorLayout({ map, terrain }: { map: BattleMap; terrain: HeightField }) {
  const reportError = useAppStore((s) => s.reportError);
  const terrainVersion = useEditorStore((s) => s.terrainVersion);
  const camera = useEditorStore((s) => s.camera);
  const activeTool = useEditorStore((s) => s.activeTool);
  const step = useEditorStore((s) => s.step);
  const preview = useEditorStore((s) => s.previewAsPlayer);
  const settingsOpen = useEditorStore((s) => s.settingsOpen);
  const exportOpen = useEditorStore((s) => s.exportOpen);
  const tool = toolById(activeTool);
  const { Overlay } = tool;

  useShortcuts('Map editor', EDITOR_SHORTCUTS);
  useEffect(() => tool.deactivate, [tool]);

  const onPointer = useCallback(
    (event: MapPointerEvent) => {
      try {
        if (event.type === 'move') {
          useEditorStore.getState().setPointer(event.point);
        }
        // Right and middle buttons belong to the camera.
        if (event.type === 'move' || event.button === 0) tool.onPointer?.(event);
      } catch (error) {
        reportError(error);
      }
    },
    [tool, reportError],
  );

  return (
    <div className="page-frame">
      <EditorHeader map={map} />
      <div className="map-editor-body">
        <div className="map-editor-main">
          <div className="editor-steps">
            <Tabs tabs={STEP_TABS} value={step} onChange={showStep} label="Editor steps" />
            <StepHelpButton step={step} />
          </div>
          <ToolBar tool={tool} step={step} />
          <Viewport tool={tool}>
            <MapView
              map={map}
              terrain={terrain}
              terrainVersion={terrainVersion}
              mode={preview ? 'player' : 'editor'}
              fogMode="off"
              camera={camera}
              ambient={preview ? map.ambientLight : 'bright'}
              onPointer={onPointer}
            >
              {SCENE_LAYERS.map(({ id, Component }) => (
                <Component key={id} />
              ))}
              {Overlay && <Overlay />}
              <ModelDropTarget />
            </MapView>
            <StepHint step={step} />
            <div className="editor-canvas-tools">
              <LayersButton />
            </div>
          </Viewport>
        </div>
        <Inspector />
      </div>
      <EditorStatus hint={tool.hint} terrain={terrain} />
      {settingsOpen && <MapSettingsDialog />}
      {exportOpen && <MapExportDialog name={map.name} load={loadEditedMap} onClose={closeExport} />}
    </div>
  );
}

// Mount counter: a late cleanup must not close a newer mount's map.
let editorSession = 0;

/** Opens a library map; shipped maps are saved as a user copy with the same id on the first edit. */
export function MapEditorPage({ mapRef }: { mapRef: DocRef }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const map = useEditorStore((s) => s.map);
  const terrain = useEditorStore((s) => s.terrain);
  const { area, id } = mapRef;

  useEffect(() => {
    const session = ++editorSession;
    repository
      .load('map', { area, id })
      .then((loaded) => {
        if (session === editorSession) useEditorStore.getState().open(loaded);
      })
      .catch(reportError);
    return () => {
      flushMap()
        .catch(reportError)
        .finally(() => {
          if (session === editorSession) useEditorStore.getState().close();
        });
    };
  }, [area, id, repository, reportError]);

  return map && terrain && map.id === id ? (
    <EditorLayout map={map} terrain={terrain} />
  ) : (
    <div className="waiting">Loading map…</div>
  );
}
