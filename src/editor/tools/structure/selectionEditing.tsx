import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Box3, Box3Helper } from 'three';
import { create } from 'zustand';
import type { BattleMap, Vec2 } from '@/core/model';
import { wallOutline } from '@/core/geometry/wallOutline';
import { distance2, lerp2, wallSegmentEnds } from '@/core/geometry/walls';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { usePropObjects } from '@/render/props/propObjects';
import { circlePoints } from '@/render/structures/drape';
import { noRaycast } from '@/render/structures/hooks';
import { useEditorStore, type Selection } from '@/state/editorStore';
import { OverlayMarker, OverlayPath, snapForDrawing } from './drafting';

type Owners = Pick<BattleMap, 'walls' | 'rooms' | 'regions'>;
type VertexKind = 'wall' | 'room' | 'region';
type SelectionKind = NonNullable<Selection>['kind'];

const SELECTION_COLOR = '#4ad6ff';
const HOVER_COLOR = '#ffe066';
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

function selectedVertices(map: Owners, selection: Selection): Vec2[] | undefined {
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

/** Bounding box of a prop's scene object, refitted every frame because models load and move. */
function PropBox({ id, color }: { id: string; color: string }) {
  const object = usePropObjects((s) => s.objects[id]);
  const helper = useMemo(() => new Box3Helper(new Box3(), color), [color]);
  useEffect(() => () => helper.dispose(), [helper]);
  useFrame(() => {
    if (object) helper.box.setFromObject(object);
  });
  return object ? <primitive object={helper} raycast={noRaycast} /> : null;
}

/** Outline of one map object; `points` replaces the stored vertices of a wall, room or region. */
function ObjectOutline(props: { kind: SelectionKind; id: string; points?: Vec2[]; color: string }) {
  const { kind, id, color } = props;
  const map = useEditorStore((s) => s.map);
  const points = props.points ?? (map ? selectedVertices(map, { kind, id, vertex: null }) : undefined);
  const wall = kind === 'wall' ? map?.walls.find((w) => w.id === id) : undefined;
  const opening = kind === 'opening' ? map?.openings.find((o) => o.id === id) : undefined;
  const light = kind === 'light' ? map?.lights.find((l) => l.id === id) : undefined;
  const openingWall = opening ? map?.walls.find((w) => w.id === opening.wallId) : undefined;
  const openingEnds = opening && openingWall ? wallSegmentEnds(openingWall)[opening.segment] : undefined;
  const rings = wall && points ? wallOutline({ ...wall, points }, map?.walls ?? []) : points ? [points] : [];
  return (
    <group>
      {rings.map((ring, i) => (
        <OverlayPath key={i} points={ring} closed color={color} />
      ))}
      {opening && openingEnds && (
        <OverlayMarker position={lerp2(openingEnds[0], openingEnds[1], opening.t)} color={color} />
      )}
      {light && <OverlayPath points={circlePoints(light.position, 1.2)} closed color={color} />}
      {kind === 'prop' && <PropBox id={id} color={color} />}
    </group>
  );
}

/**
 * Outline of the selection plus draggable vertex handles (the dragged vertex follows the cursor),
 * and a lighter outline of the object a click would select.
 */
export function SelectionOverlay() {
  const map = useEditorStore((s) => s.map);
  const selection = useEditorStore((s) => s.selection);
  const hover = useEditorStore((s) => s.hover);
  const drag = useVertexDrag((s) => s.drag);
  const stored = map ? selectedVertices(map, selection) : undefined;
  const dragging = drag && selection && drag.id === selection.id;
  const points = stored && dragging ? stored.map((p, i) => (i === drag.vertex ? drag.to : p)) : stored;
  const hovered = hover && hover.id !== selection?.id ? hover : null;
  return (
    <group>
      {selection && <ObjectOutline kind={selection.kind} id={selection.id} points={points} color={SELECTION_COLOR} />}
      {points?.map((p, i) => (
        <OverlayMarker
          key={i}
          position={p}
          color={i === selection?.vertex ? ACTIVE_VERTEX_COLOR : VERTEX_COLOR}
          size={0.4}
        />
      ))}
      {hovered && <ObjectOutline kind={hovered.kind as SelectionKind} id={hovered.id} color={HOVER_COLOR} />}
    </group>
  );
}
