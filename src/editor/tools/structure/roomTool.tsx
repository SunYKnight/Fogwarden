import { create } from 'zustand';
import { newId, type Room, type Vec2, type Wall } from '@/core/model';
import { closedWallAt } from '@/core/geometry/wallEdit';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { CheckboxField } from '@/ui/components/fields';
import type { EditorTool } from '../../tool';
import { addItem, editorMap } from './documentEdits';
import {
  DraftControls,
  DraftOverlay,
  draftPointer,
  OverlayPath,
  resetDraft,
  useDraft,
  useDraftKeys,
  type DraftActions,
} from './drafting';
import { RoomFields, type RoomTemplate } from './propertyFields';

const useRoomTemplate = create<RoomTemplate & { fromWalls: boolean }>(() => ({
  fromWalls: true,
  floorFt: null,
  ceilingFt: 10,
  roof: true,
  roofMaterial: 'wood',
}));

const useRoomPreview = create<{ wall: Wall | null }>(() => ({ wall: null }));

function addRoom(polygon: Vec2[], ceilingFt: number): void {
  const map = editorMap();
  const { fromWalls: _fromWalls, ...template } = useRoomTemplate.getState();
  const room: Room = { ...template, ceilingFt, id: newId(), name: `Room ${map.rooms.length + 1}`, polygon };
  addItem('Add room', (d) => d.rooms, room, 'room');
}

const ROOM_DRAFT: DraftActions = {
  minPoints: 3,
  finish: (points) => addRoom(points, useRoomTemplate.getState().ceilingFt),
};

/** Closed wall a click would turn into a room, when that mode is on and nothing is being drawn. */
function wallUnder(event: MapPointerEvent): Wall | null {
  const drawing = useDraft.getState().points.length > 0;
  return event.point && useRoomTemplate.getState().fromWalls && !drawing
    ? closedWallAt(event.point, editorMap().walls)
    : null;
}

function roomPointer(event: MapPointerEvent): void {
  const wall = wallUnder(event);
  if (event.type === 'move') {
    useRoomPreview.setState({ wall });
  }
  if (wall && event.type === 'down' && event.button === 0) {
    const taken = editorMap().rooms.some((r) => JSON.stringify(r.polygon) === JSON.stringify(wall.points));
    if (taken) {
      throw new Error('This closed wall already has a room');
    }
    // The roof belongs on top of the walls that enclose the room.
    addRoom(wall.points, wall.heightFt);
  } else {
    draftPointer(event, ROOM_DRAFT);
  }
}

function RoomToolPanel() {
  const template = useRoomTemplate();
  useDraftKeys(ROOM_DRAFT);
  return (
    <>
      <CheckboxField
        label="From closed wall"
        value={template.fromWalls}
        onChange={(fromWalls) => useRoomTemplate.setState({ fromWalls })}
      />
      <DraftControls actions={ROOM_DRAFT} />
      <RoomFields value={template} onChange={(_, patch) => useRoomTemplate.setState(patch)} />
    </>
  );
}

function RoomToolOverlay() {
  const wall = useRoomPreview((s) => s.wall);
  return (
    <group>
      <DraftOverlay closed color="#7bed9f" />
      {wall && <OverlayPath points={wall.points} closed color="#7bed9f" dashed />}
    </group>
  );
}

export const roomTool: EditorTool = {
  id: 'room',
  label: 'Room',
  icon: 'room',
  step: 'areas',
  shortcut: 'r',
  hint:
    'Click inside or on a closed wall to make it a room, or click polygon points; ' +
    'double-click, Enter or the first point finishes; Esc cancels',
  cursor: 'crosshair',
  onPointer: roomPointer,
  Panel: RoomToolPanel,
  Overlay: RoomToolOverlay,
  deactivate: () => {
    resetDraft();
    useRoomPreview.setState({ wall: null });
  },
};
