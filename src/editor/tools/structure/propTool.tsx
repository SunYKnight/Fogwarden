import { TransformControls } from '@react-three/drei';
import { createPortal, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useId } from 'react';
import { Raycaster, Vector2, type Camera, type Object3D } from 'three';
import { z } from 'zod';
import { create } from 'zustand';
import { newId, type AssetRef, type MapPoint, type Prop, type WorldVec3 } from '@/core/model';
import { findHit } from '@/render/MapView';
import { usePropObjects } from '@/render/props/propObjects';
import { useAppStore } from '@/state/appStore';
import { useEditorStore } from '@/state/editorStore';
import { readGltfJson } from '@/sync/relayClient';
import { CheckboxField } from '@/ui/components/fields';
import { Button, useShortcuts } from '@/ui/kit';
import type { EditorTool } from '../../tool';
import { addItem, editItem, editorMap } from './documentEdits';
import { OverlayMarker } from './drafting';

// glTF stores meters (Blender's unit) and the map uses feet.
const METERS_TO_FEET = 3.28084;
const RAD_TO_DEG = 180 / Math.PI;
const ROTATION_SNAP_DEG = 15;
const SCALE_SNAP = 0.1;
const MODEL_FILE = /\.(glb|gltf)$/i;
// GLTFLoader runs without KTX2, Draco or meshopt decoders.
const UNSUPPORTED_EXTENSIONS: Record<string, true> = {
  KHR_texture_basisu: true,
  KHR_draco_mesh_compression: true,
  EXT_meshopt_compression: true,
  KHR_meshopt_compression: true,
};
const requiredExtensionsSchema = z.object({ extensionsRequired: z.array(z.string()).optional() });

type GizmoMode = 'translate' | 'rotate' | 'scale';
const GIZMO_LABELS: Record<GizmoMode, string> = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' };

interface PropToolState {
  /** Imported model waiting for a click on the map. */
  pending: { asset: AssetRef; name: string } | null;
  /** Last imported model, so it can be placed again without importing twice. */
  last: { asset: AssetRef; name: string } | null;
  importing: boolean;
  gizmo: GizmoMode;
  snap: boolean;
  cursor: MapPoint | null;
}

export const usePropTool = create<PropToolState>(() => ({
  pending: null,
  last: null,
  importing: false,
  gizmo: 'translate',
  snap: true,
  cursor: null,
}));

/** Throws when the model needs a decoder the prop loader lacks. */
export function assertLoadableModel(name: string, bytes: Uint8Array): void {
  const document = readGltfJson({ area: 'content', path: name }, bytes);
  const { extensionsRequired = [] } = requiredExtensionsSchema.parse(document);
  const missing = extensionsRequired.filter((e) => UNSUPPORTED_EXTENSIONS[e]);
  if (missing.length > 0) {
    throw new Error(`${name} needs ${missing.join(', ')}; export it without texture or mesh compression`);
  }
}

/** Copies the chosen model file (plus .bin/texture files of a .gltf) into the map's asset folder. */
async function importModel(files: File[]): Promise<void> {
  const model = files.find((f) => MODEL_FILE.test(f.name));
  if (!model) {
    throw new Error('Choose a .glb or .gltf file');
  }
  assertLoadableModel(model.name, new Uint8Array(await model.arrayBuffer()));
  const map = editorMap();
  const { repository } = useAppStore.getState();
  usePropTool.setState({ importing: true });
  try {
    const refs = await Promise.all(
      files.map(
        async (f) =>
          [f, await repository.importMapAsset(map.id, f.name, new Uint8Array(await f.arrayBuffer()))] as const,
      ),
    );
    const asset = refs.find(([f]) => f === model)![1];
    const imported = { asset, name: model.name.replace(MODEL_FILE, '') };
    usePropTool.setState({ pending: imported, last: imported });
  } finally {
    usePropTool.setState({ importing: false });
  }
}

function placeProp(point: MapPoint): void {
  const { pending } = usePropTool.getState();
  if (pending) {
    const prop: Prop = {
      id: newId(),
      name: pending.name,
      asset: pending.asset,
      position: [point.x, point.elevationFt, point.y],
      rotationDeg: [0, 0, 0],
      scale: [METERS_TO_FEET, METERS_TO_FEET, METERS_TO_FEET],
      projectMap: false,
      occludesSight: true,
      blocksMovement: true,
      walkable: false,
    };
    addItem('Add prop', (d) => d.props, prop, 'prop');
    usePropTool.setState({ pending: null });
  }
}

/** Gizmo mode buttons shared by the prop tool and the prop selection panel. */
export function GizmoModeButtons() {
  const gizmo = usePropTool((s) => s.gizmo);
  return (
    <div className="row">
      {(Object.entries(GIZMO_LABELS) as [GizmoMode, string][]).map(([mode, label]) => (
        <Button
          key={mode}
          label={label}
          active={mode === gizmo}
          onClick={() => usePropTool.setState({ gizmo: mode })}
        />
      ))}
    </div>
  );
}

function PropToolPanel() {
  const pending = usePropTool((s) => s.pending);
  const last = usePropTool((s) => s.last);
  const importing = usePropTool((s) => s.importing);
  const snap = usePropTool((s) => s.snap);
  const inputId = useId();
  const reportError = useAppStore((s) => s.reportError);
  useShortcuts(
    'Map editor: prop',
    [{ keys: 'Escape', label: 'Stop placing the model', run: () => usePropTool.setState({ pending: null }) }],
    pending !== null,
  );
  return (
    <>
      <div className="field">
        <label htmlFor={inputId}>Import model</label>
        <input
          id={inputId}
          type="file"
          accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp"
          multiple
          disabled={importing}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            importModel(files).catch(reportError);
          }}
        />
      </div>
      <span className="muted">
        {importing
          ? 'Importing…'
          : pending
            ? `Click the map to place “${pending.name}”.`
            : 'A .glb, or a .gltf with its .bin and textures; or drop the files on the map.'}
      </span>
      {last && !pending && (
        <Button
          icon="plus"
          label={`Place “${last.name}” again`}
          onClick={() => usePropTool.setState({ pending: last })}
        />
      )}
      <span className="muted">Selected prop:</span>
      <GizmoModeButtons />
      <CheckboxField label="Snap to grid" value={snap} onChange={(v) => usePropTool.setState({ snap: v })} />
    </>
  );
}

const dropRay = new Raycaster();
const dropNdc = new Vector2();

/** Map point under a screen position: the nearest tagged map object, like a pointer event. */
function mapPointAt(event: DragEvent, canvas: HTMLElement, camera: Camera, scene: Object3D): MapPoint | null {
  const rect = canvas.getBoundingClientRect();
  dropNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  dropRay.setFromCamera(dropNdc, camera);
  const hit = dropRay.intersectObjects(scene.children, true).find((i) => findHit(i.object) !== null);
  return hit ? { x: hit.point.x, y: hit.point.z, elevationFt: hit.point.y } : null;
}

async function dropModel(files: File[], point: MapPoint | null): Promise<void> {
  if (!point) {
    throw new Error('Drop the model onto the map');
  }
  await importModel(files);
  placeProp(point);
}

/** Dropping a .glb (or a .gltf with its files) on the canvas imports it and places it at the drop point. */
export function ModelDropTarget() {
  const canvas = useThree((s) => s.gl.domElement);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // Without preventDefault on dragover the browser refuses the drop.
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        dropModel(files, mapPointAt(e, canvas, camera, scene)).catch(useAppStore.getState().reportError);
      }
    };
    canvas.addEventListener('dragover', over);
    canvas.addEventListener('drop', drop);
    return () => {
      canvas.removeEventListener('dragover', over);
      canvas.removeEventListener('drop', drop);
    };
  }, [canvas, camera, scene]);
  return null;
}

function rounded(values: number[]): WorldVec3 {
  const [x, y, z] = values.map((v) => Math.round(v * 1000) / 1000);
  return [x!, y!, z!];
}

function sameVec(a: WorldVec3, b: WorldVec3): boolean {
  return a.every((v, i) => v === b[i]);
}

/** TransformControls on the selected prop's scene object; one undo step per drag. */
function PropGizmo() {
  const scene = useThree((s) => s.scene);
  const id = useEditorStore((s) => (s.selection?.kind === 'prop' ? s.selection.id : null));
  const feetPerSquare = useEditorStore((s) => s.map?.grid.feetPerSquare ?? 5);
  const object = usePropObjects((s) => (id ? s.objects[id] : undefined));
  const gizmo = usePropTool((s) => s.gizmo);
  const snap = usePropTool((s) => s.snap);
  const commit = useCallback(() => {
    try {
      if (object && id) {
        const position = rounded(object.position.toArray());
        const { x, y, z } = object.rotation;
        const rotationDeg = rounded([x * RAD_TO_DEG, y * RAD_TO_DEG, z * RAD_TO_DEG]);
        const scale = rounded(object.scale.toArray());
        editItem(
          'Transform prop',
          (d) => d.props,
          id,
          (prop) => {
            if (!sameVec(prop.position, position)) prop.position = position;
            if (!sameVec(prop.rotationDeg, rotationDeg)) prop.rotationDeg = rotationDeg;
            if (!sameVec(prop.scale, scale)) prop.scale = scale;
          },
        );
      }
    } catch (error) {
      useAppStore.getState().reportError(error);
    }
  }, [object, id]);
  // Outside MapView's pointer group: gizmo clicks never reach tools as hits.
  return object
    ? createPortal(
        <TransformControls
          object={object}
          mode={gizmo}
          translationSnap={snap ? feetPerSquare : null}
          rotationSnap={snap ? ROTATION_SNAP_DEG / RAD_TO_DEG : null}
          scaleSnap={snap ? SCALE_SNAP : null}
          onMouseUp={commit}
        />,
        scene,
      )
    : null;
}

function PropToolOverlay() {
  const cursor = usePropTool((s) => s.cursor);
  const pending = usePropTool((s) => s.pending);
  return (
    <group>
      <PropGizmo />
      {pending && cursor && <OverlayMarker position={cursor} color="#c56cf0" />}
    </group>
  );
}

export const propTool: EditorTool = {
  id: 'prop',
  label: 'Prop',
  icon: 'cube',
  step: 'objects',
  shortcut: 'p',
  hint:
    'Import a .glb/.gltf in the tool bar (or drop it on the map), click to place it; ' +
    'click a prop to move, rotate or scale it',
  cursor: 'crosshair',
  onPointer: (event) => {
    const select = event.type === 'down' && event.button === 0 && event.hit?.kind === 'prop';
    if (event.point && event.type === 'move') {
      usePropTool.setState({ cursor: event.point });
    } else if (select && event.hit) {
      useEditorStore.getState().select({ kind: 'prop', id: event.hit.id, vertex: null });
    } else if (event.point && event.type === 'down' && event.button === 0) {
      placeProp(event.point);
    }
  },
  Panel: PropToolPanel,
  Overlay: PropToolOverlay,
  deactivate: () => usePropTool.setState({ pending: null, cursor: null }),
};
