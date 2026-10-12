import { useCallback, useEffect, useState } from 'react';
import type { BattleMap, DocRef } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { SELECTION_PANELS } from '@/editor/selectionPanels';
import { toolById, TOOLS } from '@/editor/tools';
import { SCENE_LAYERS } from '@/render/layers';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { MapView } from '@/render/MapView';
import { useAppStore } from '@/state/appStore';
import { flushMap } from '@/state/autosave';
import { LAYERS, useEditorStore } from '@/state/editorStore';
import { MapPropertiesPanel } from './MapPropertiesPanel';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

function handleEditorKey(e: KeyboardEvent): void {
  const editor = useEditorStore.getState();
  const key = e.key.toLowerCase();
  const command = e.ctrlKey || e.metaKey;
  const tool = TOOLS.find((t) => t.shortcut === key);
  if (command && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) editor.redo();
    else editor.undo();
  } else if (command && key === 'y') {
    e.preventDefault();
    editor.redo();
  } else if (!command && !e.altKey && tool) {
    editor.setTool(tool.id);
  } else if (key === 'escape') {
    editor.select(null);
  }
}

function useEditorShortcuts() {
  useEffect(() => {
    // Typing in a side panel field must not trigger tools or undo.
    const onKey = (e: KeyboardEvent) => {
      if (!isTyping(e.target)) handleEditorKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function EditorToolbar() {
  const map = useEditorStore((s) => s.map);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const camera = useEditorStore((s) => s.camera);
  const layers = useEditorStore((s) => s.layers);
  const dirty = useEditorStore((s) => s.revision !== s.savedRevision);
  const preview = useEditorStore((s) => s.previewAsPlayer);
  const { undo, redo, setCamera, toggleLayer, setPreviewAsPlayer } = useEditorStore.getState();
  const navigate = useAppStore((s) => s.navigate);
  const reportError = useAppStore((s) => s.reportError);
  const [showLayers, setShowLayers] = useState(false);

  return (
    <div className="topbar toolbar">
      <button className="crumb" onClick={() => flushMap().then(() => navigate({ page: 'maps' }), reportError)}>
        Maps
      </button>
      <span className="muted">›</span>
      <strong>{map?.name}</strong>
      <span className="muted">{dirty ? 'saving…' : 'saved'}</span>
      <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
        ↶
      </button>
      <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">
        ↷
      </button>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <button onClick={() => setShowLayers(!showLayers)}>Layers ▾</button>
        {showLayers && (
          <div className="panel" style={{ position: 'absolute', right: 0, top: 32, zIndex: 10, minWidth: 160 }}>
            {LAYERS.map((layer) => (
              <label key={layer} className="row">
                <input type="checkbox" checked={layers[layer]} onChange={() => toggleLayer(layer)} />
                {layer}
              </label>
            ))}
          </div>
        )}
      </div>
      <label className="row">
        <input type="checkbox" checked={preview} onChange={(e) => setPreviewAsPlayer(e.target.checked)} />
        Preview as player
      </label>
      <button className={camera === 'top' ? 'active' : ''} onClick={() => setCamera('top')}>
        Top
      </button>
      <button className={camera === 'perspective' ? 'active' : ''} onClick={() => setCamera('perspective')}>
        3D
      </button>
    </div>
  );
}

function SelectionPanel() {
  const selection = useEditorStore((s) => s.selection);
  const Panel = selection ? SELECTION_PANELS[selection.kind] : undefined;
  return Panel && selection ? <Panel id={selection.id} /> : null;
}

function EditorLayout({ map, terrain }: { map: BattleMap; terrain: HeightField }) {
  const reportError = useAppStore((s) => s.reportError);
  const terrainVersion = useEditorStore((s) => s.terrainVersion);
  const camera = useEditorStore((s) => s.camera);
  const activeTool = useEditorStore((s) => s.activeTool);
  const preview = useEditorStore((s) => s.previewAsPlayer);
  const tool = toolById(activeTool);
  const { Panel, Overlay } = tool;

  useEffect(() => tool.deactivate, [tool]);

  const onPointer = useCallback(
    (event: MapPointerEvent) => {
      try {
        // Right and middle buttons belong to the camera.
        if (event.type === 'move' || event.button === 0) tool.onPointer?.(event);
      } catch (error) {
        reportError(error);
      }
    },
    [tool, reportError],
  );

  return (
    <div className="editor">
      <EditorToolbar />
      <div className="tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={t.id === activeTool ? 'active' : ''}
            title={`${t.label}${t.shortcut ? ` (${t.shortcut.toUpperCase()})` : ''}`}
            onClick={() => useEditorStore.getState().setTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="viewport">
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
        </MapView>
        {tool.hint && <div className="viewport-hint">{tool.hint}</div>}
      </div>
      <div className="side">
        {Panel && (
          <div className="panel">
            <h2>{tool.label}</h2>
            <Panel />
          </div>
        )}
        <SelectionPanel />
        <MapPropertiesPanel />
      </div>
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
  useEditorShortcuts();

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
