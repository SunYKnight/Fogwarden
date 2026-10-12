import { Line } from '@react-three/drei';
import { create } from 'zustand';
import type { Vec2 } from '@/core/model';
import { snapPoint, type SnapKind, type SnapResult } from '@/core/geometry/snapping';
import { distance2 } from '@/core/geometry/walls';
import { useMapRender, type MapPointerEvent } from '@/render/mapRenderContext';
import { drapedPath, terrainPoint } from '@/render/structures/drape';
import { noRaycast } from '@/render/structures/hooks';
import { useAppStore } from '@/state/appStore';
import { Button, useShortcuts } from '@/ui/kit';
import { editorMap } from './documentEdits';

const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_FT = 1;
/** Overlays float above the terrain and ignore depth so walls never hide them. */
export const OVERLAY_LIFT_FT = 0.4;
export const OVERLAY_ORDER = 10;

const SNAP_COLORS: Record<SnapKind, string> = {
  vertex: '#ff5ad1',
  corner: '#4ad6ff',
  midpoint: '#ffd84a',
  none: '#ffffff',
};

interface DraftState {
  points: Vec2[];
  cursor: SnapResult | null;
  lastDown: { at: number; point: Vec2 } | null;
}

/** Points of the polyline or polygon being drawn by the active tool. */
export const useDraft = create<DraftState>(() => ({ points: [], cursor: null, lastDown: null }));

export function resetDraft(): void {
  useDraft.setState({ points: [], cursor: null, lastDown: null });
}

/**
 * Snaps a point while drawing to wall vertices (plus `extra` vertices), grid corners and square-edge
 * midpoints; `free` (Shift) keeps the point as is. Vertices equal to `exclude` are ignored so a
 * dragged vertex does not stick to its old position.
 */
export function snapForDrawing(
  point: Vec2,
  free: boolean,
  extra: Vec2[] = [],
  exclude: Vec2 | null = null,
): SnapResult {
  const map = editorMap();
  const vertices = [...map.walls.flatMap((w) => w.points), ...extra].filter(
    (v) => !exclude || distance2(v, exclude) > 1e-9,
  );
  const step = map.grid.feetPerSquare;
  return free
    ? { point: { x: point.x, y: point.y }, kind: 'none' }
    : snapPoint(point, step, { radiusFt: step / 4, vertices });
}

export interface DraftActions {
  minPoints: number;
  /** `closedByClick` is set when the user finished by clicking the first point again. */
  finish(points: Vec2[], closedByClick: boolean): void;
}

export function finishDraft(actions: DraftActions, closedByClick = false): void {
  const { points } = useDraft.getState();
  if (points.length < actions.minPoints) {
    throw new Error(`Place at least ${actions.minPoints} points first`);
  }
  resetDraft();
  actions.finish(points, closedByClick);
}

export function removeLastDraftPoint(): void {
  useDraft.setState((s) => ({ points: s.points.slice(0, -1), lastDown: null }));
}

/**
 * Click adds a snapped point; a second click on the same spot (double-click) or a click on the
 * first point finishes. Moves only update the cursor preview.
 */
export function draftPointer(event: MapPointerEvent, actions: DraftActions): void {
  const { points, lastDown } = useDraft.getState();
  const snapped = event.point ? snapForDrawing(event.point, event.shiftKey, points) : null;
  if (snapped && event.type === 'move') {
    useDraft.setState({ cursor: snapped });
  }
  if (snapped && event.type === 'down' && event.button === 0) {
    const now = performance.now();
    const double =
      lastDown !== null &&
      now - lastDown.at < DOUBLE_CLICK_MS &&
      distance2(lastDown.point, snapped.point) < DOUBLE_CLICK_FT;
    const closes = points.length >= 3 && distance2(points[0]!, snapped.point) < 1e-6;
    if (double || closes) {
      finishDraft(actions, closes);
    } else {
      useDraft.setState({
        points: [...points, snapped.point],
        cursor: snapped,
        lastDown: { at: now, point: snapped.point },
      });
    }
  }
}

/** Status bar text for what the drawing cursor snapped to. */
export const SNAP_LABELS: Record<SnapKind, string> = {
  vertex: 'Snap: wall vertex',
  corner: 'Snap: grid corner',
  midpoint: 'Snap: edge midpoint',
  none: 'Snap: none (Shift = free)',
};

function finishReported(actions: DraftActions): void {
  try {
    finishDraft(actions);
  } catch (error) {
    useAppStore.getState().reportError(error);
  }
}

/**
 * Enter finishes, Escape cancels, Backspace removes the last point while a drawing is in progress;
 * otherwise the keys keep their editor meaning (deselect, delete the selection).
 */
export function useDraftKeys(actions: DraftActions): void {
  const drawing = useDraft((s) => s.points.length > 0);
  useShortcuts(
    'Map editor: drawing',
    [
      { keys: 'Enter', label: 'Finish the drawing', run: () => finishReported(actions) },
      { keys: 'Backspace', label: 'Remove the last point', run: removeLastDraftPoint },
      { keys: 'Escape', label: 'Cancel the drawing', run: resetDraft },
    ],
    drawing,
  );
}

/** Mouse-free alternatives to double-click and the keyboard shortcuts. */
export function DraftControls({ actions }: { actions: DraftActions }) {
  const count = useDraft((s) => s.points.length);
  return (
    <div className="row">
      <span className="muted">{count} point(s)</span>
      <Button
        icon="check"
        label="Finish"
        shortcut="Enter"
        variant="primary"
        disabled={count === 0}
        onClick={() => finishReported(actions)}
      />
      <Button
        icon="undo"
        label="Undo point"
        shortcut="Backspace"
        disabled={count === 0}
        onClick={removeLastDraftPoint}
      />
      <Button icon="close" label="Cancel" shortcut="Esc" disabled={count === 0} onClick={resetDraft} />
    </div>
  );
}

/** Small always-on-top sphere marking a point in overlays. */
export function OverlayMarker({
  position,
  color,
  size = 0.5,
}: {
  position: Vec2 | [number, number, number];
  color: string;
  size?: number;
}) {
  const { terrain } = useMapRender();
  const at = Array.isArray(position) ? position : terrainPoint(terrain, position, OVERLAY_LIFT_FT);
  return (
    <mesh position={at} raycast={noRaycast} renderOrder={OVERLAY_ORDER}>
      <sphereGeometry args={[size, 12, 8]} />
      <meshBasicMaterial color={color} depthTest={false} transparent />
    </mesh>
  );
}

/** Always-on-top line following the terrain. */
export function OverlayPath({
  points,
  closed,
  color,
  dashed = false,
}: {
  points: Vec2[];
  closed: boolean;
  color: string;
  dashed?: boolean;
}) {
  const { terrain } = useMapRender();
  return points.length >= 2 ? (
    <Line
      points={drapedPath(points, closed, terrain, OVERLAY_LIFT_FT)}
      color={color}
      lineWidth={2}
      dashed={dashed}
      dashSize={1}
      gapSize={0.6}
      depthTest={false}
      transparent
      renderOrder={OVERLAY_ORDER}
      raycast={noRaycast}
    />
  ) : null;
}

/** Draft polyline with the cursor as the next point and a marker showing what the cursor snaps to. */
export function DraftOverlay({ closed, color }: { closed: boolean; color: string }) {
  const points = useDraft((s) => s.points);
  const cursor = useDraft((s) => s.cursor);
  const path = cursor ? [...points, cursor.point] : points;
  return (
    <group>
      <OverlayPath points={path} closed={closed} color={color} />
      {points.map((p, i) => (
        <OverlayMarker key={i} position={p} color={color} size={0.35} />
      ))}
      {cursor && <OverlayMarker position={cursor.point} color={SNAP_COLORS[cursor.kind]} />}
    </group>
  );
}
