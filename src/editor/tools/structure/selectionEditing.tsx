import { create } from 'zustand';
import type { BattleMap, Vec2 } from '@/core/model';
import { wallOutline } from '@/core/geometry/wallOutline';
import { distance2, lerp2, wallSegmentEnds } from '@/core/geometry/walls';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { circlePoints } from '@/render/structures/drape';
import { useEditorStore, type Selection } from '@/state/editorStore';
import { OverlayMarker, OverlayPath, snapForDrawing } from './drafting';

type Owners = Pick<BattleMap, 'walls' | 'rooms' | 'regions'>;
type VertexKind = 'wall' | 'room' | 'region';

const SELECTION_COLOR = '#4ad6ff';
const VERTEX_COLOR = '#ffffff';
const ACTIVE_VERTEX_COLOR = '#ff5ad1';

/** Editable point lists by selection kind; works on documents and immer drafts alike. */
const VERTEX_LISTS: Record<VertexKind, (map: Owners, id: string) => Vec2[] | undefined> = {
  wall: (map, id) => map.walls.find((w) => w.id === id)?.points,
  room: (map, id) => map.rooms.find((r) => r.id === id)?.polygon,
  region: (map, id) => map.regions.find((r) => r.id === id)?.polygon,
};

function isVertexKind(kind: string): kind is VertexKind {
  return kind in VERTEX_LISTS;
}

export function selectedVertices(map: Owners, selection: Selection): Vec2[] | undefined {
  return selection && isVertexKind(selection.kind) ? VERTEX_LISTS[selection.kind](map, selection.id) : undefined;
}

interface VertexDrag {
  kind: VertexKind;
  id: string;
  vertex: number;
  from: Vec2;
  to: Vec2;
}

const useVertexDrag = create<{ drag: VertexDrag | null }>(() => ({ drag: null }));

function nearestVertex(points: Vec2[], point: Vec2, radiusFt: number): number {
  return points.reduce(
    (best, p, i) =>
      distance2(p, point) <= radiusFt && (best < 0 || distance2(p, point) < distance2(points[best]!, point)) ? i : best,
    -1,
  );
}

function grab(event: MapPointerEvent): VertexDrag | null {
  const { map, selection } = useEditorStore.getState();
  const points = map && event.point ? selectedVertices(map, selection) : undefined;
  const vertex = points && map && event.point ? nearestVertex(points, event.point, map.grid.feetPerSquare * 0.3) : -1;
  return selection && isVertexKind(selection.kind) && points && vertex >= 0
    ? { kind: selection.kind, id: selection.id, vertex, from: points[vertex]!, to: points[vertex]! }
    : null;
}

/**
 * Vertex dragging for the selected wall, room or region (select tool). Returns whether the event
 * belonged to a drag, so the select tool skips its own click handling. The drop is one undo step.
 */
export function vertexDragPointer(event: MapPointerEvent): boolean {
  const { drag } = useVertexDrag.getState();
  const grabbed = event.type === 'down' && event.button === 0 && !drag ? grab(event) : null;
  if (grabbed) {
    useVertexDrag.setState({ drag: grabbed });
    useEditorStore.getState().select({ kind: grabbed.kind, id: grabbed.id, vertex: grabbed.vertex });
  } else if (drag && event.type === 'move' && event.point) {
    const to = snapForDrawing(event.point, event.shiftKey, [], drag.from).point;
    useVertexDrag.setState({ drag: { ...drag, to } });
  } else if (drag && event.type === 'up') {
    useVertexDrag.setState({ drag: null });
    if (distance2(drag.from, drag.to) > 1e-9) {
      useEditorStore.getState().edit('Move vertex', (d) => {
        const points = VERTEX_LISTS[drag.kind](d, drag.id);
        if (points?.[drag.vertex]) points[drag.vertex] = drag.to;
      });
    }
  }
  return grabbed !== null || drag !== null;
}

export function cancelVertexDrag(): void {
  useVertexDrag.setState({ drag: null });
}

/** Outline of the selection plus draggable vertex handles; the dragged vertex follows the cursor. */
export function SelectionOverlay() {
  const map = useEditorStore((s) => s.map);
  const selection = useEditorStore((s) => s.selection);
  const drag = useVertexDrag((s) => s.drag);
  const stored = map ? selectedVertices(map, selection) : undefined;
  const dragging = drag && selection && drag.id === selection.id;
  const points = stored && dragging ? stored.map((p, i) => (i === drag.vertex ? drag.to : p)) : stored;
  const wall = selection?.kind === 'wall' ? map?.walls.find((w) => w.id === selection.id) : undefined;
  const opening = selection?.kind === 'opening' ? map?.openings.find((o) => o.id === selection.id) : undefined;
  const light = selection?.kind === 'light' ? map?.lights.find((l) => l.id === selection.id) : undefined;
  const openingWall = opening ? map?.walls.find((w) => w.id === opening.wallId) : undefined;
  const openingEnds = opening && openingWall ? wallSegmentEnds(openingWall)[opening.segment] : undefined;
  const rings = wall && points ? wallOutline({ ...wall, points }, map?.walls ?? []) : points ? [points] : [];
  return (
    <group>
      {rings.map((ring, i) => (
        <OverlayPath key={i} points={ring} closed color={SELECTION_COLOR} />
      ))}
      {points?.map((p, i) => (
        <OverlayMarker
          key={i}
          position={p}
          color={i === selection?.vertex ? ACTIVE_VERTEX_COLOR : VERTEX_COLOR}
          size={0.4}
        />
      ))}
      {opening && openingEnds && (
        <OverlayMarker position={lerp2(openingEnds[0], openingEnds[1], opening.t)} color={SELECTION_COLOR} />
      )}
      {light && <OverlayPath points={circlePoints(light.position, 1.2)} closed color={SELECTION_COLOR} />}
    </group>
  );
}
