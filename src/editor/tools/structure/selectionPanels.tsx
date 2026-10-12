import type { ComponentType } from 'react';
import { newId, type Vec2, type Wall, type WorldVec3 } from '@/core/model';
import { splitWallAtVertex } from '@/core/geometry/wallEdit';
import { wallSegmentEnds } from '@/core/geometry/walls';
import { useEditorStore, type Selection } from '@/state/editorStore';
import { CheckboxField, NumberField, SelectField, TextField } from '@/ui/components/fields';
import { editItem, editorMap, removeItem } from './documentEdits';
import { LightFields, OpeningFields, RegionFields, RoomFields, WallFields } from './propertyFields';
import { GizmoModeButtons } from './propTool';

type PanelProps = { id: string };

function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button className="danger" onClick={onDelete}>
      {label}
    </button>
  );
}

/** Vertex picker plus coordinates, so vertices can be edited without dragging. */
function VertexEditor(props: {
  kind: 'wall' | 'room' | 'region';
  id: string;
  points: Vec2[];
  onMove: (vertex: number, point: Vec2) => void;
}) {
  const { kind, id, points, onMove } = props;
  const vertex = useEditorStore((s) => (s.selection?.id === id ? s.selection.vertex : null));
  const point = vertex === null ? undefined : points[vertex];
  return (
    <>
      <SelectField
        label="Vertex"
        value={vertex === null ? '' : String(vertex)}
        options={['', ...points.map((_, i) => String(i))]}
        format={(v) => (v === '' ? '–' : `#${Number(v) + 1}`)}
        onChange={(v) => useEditorStore.getState().select({ kind, id, vertex: v === '' ? null : Number(v) })}
      />
      {vertex !== null && point && (
        <>
          <NumberField
            label="Vertex X"
            value={point.x}
            step={0.5}
            suffix="ft"
            onChange={(x) => onMove(vertex, { ...point, x })}
          />
          <NumberField
            label="Vertex Y"
            value={point.y}
            step={0.5}
            suffix="ft"
            onChange={(y) => onMove(vertex, { ...point, y })}
          />
        </>
      )}
    </>
  );
}

function Vec3Fields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: WorldVec3;
  onChange: (next: WorldVec3) => void;
}) {
  const axes = ['X (east)', 'Y (up)', 'Z (south)'];
  return (
    <>
      {axes.map((axis, i) => (
        <NumberField
          key={axis}
          label={`${label} ${axis}`}
          value={value[i]!}
          step={0.5}
          onChange={(v) => {
            const next: WorldVec3 = [...value];
            next[i] = v;
            onChange(next);
          }}
        />
      ))}
    </>
  );
}

function splitWall(wall: Wall, vertex: number): void {
  const split = splitWallAtVertex(wall, editorMap().openings, vertex, newId());
  const editor = useEditorStore.getState();
  editor.edit('Split wall', (d) => {
    d.walls.splice(
      d.walls.findIndex((w) => w.id === wall.id),
      1,
      ...split.walls,
    );
    d.openings = [...d.openings.filter((o) => o.wallId !== wall.id), ...split.openings];
  });
  editor.select({ kind: 'wall', id: wall.id, vertex: null });
}

function deleteWall(id: string): void {
  const editor = useEditorStore.getState();
  editor.edit('Delete wall', (d) => {
    d.walls = d.walls.filter((w) => w.id !== id);
    d.openings = d.openings.filter((o) => o.wallId !== id);
  });
  editor.select(null);
}

function WallPanel({ id }: PanelProps) {
  const wall = useEditorStore((s) => s.map?.walls.find((w) => w.id === id));
  const vertex = useEditorStore((s) => (s.selection?.id === id ? s.selection.vertex : null));
  const ring = wall ? wall.closed && wall.points.length > 2 : false;
  const canSplit = wall !== undefined && vertex !== null && (ring || (vertex > 0 && vertex < wall.points.length - 1));
  return wall ? (
    <div className="panel">
      <h2>Wall</h2>
      <p className="muted">
        {wall.points.length} points, {ring ? 'closed' : 'open'}
      </p>
      <WallFields
        value={wall}
        onChange={(label, patch) =>
          editItem(
            label,
            (d) => d.walls,
            id,
            (w) => Object.assign(w, patch),
          )
        }
      />
      <VertexEditor
        kind="wall"
        id={id}
        points={wall.points}
        onMove={(i, p) =>
          editItem(
            'Move vertex',
            (d) => d.walls,
            id,
            (w) => void (w.points[i] = p),
          )
        }
      />
      <div className="row">
        <button
          disabled={!canSplit}
          title={
            ring ? 'Opens the closed wall at the selected vertex' : 'Splits the wall in two at the selected vertex'
          }
          onClick={() => splitWall(wall, vertex!)}
        >
          Split at vertex
        </button>
        <button
          disabled={ring || wall.points.length < 3}
          onClick={() =>
            editItem(
              'Close wall',
              (d) => d.walls,
              id,
              (w) => void (w.closed = true),
            )
          }
        >
          Close
        </button>
        <DeleteButton label="Delete" onDelete={() => deleteWall(id)} />
      </div>
    </div>
  ) : null;
}

function OpeningPanel({ id }: PanelProps) {
  const opening = useEditorStore((s) => s.map?.openings.find((o) => o.id === id));
  const wall = useEditorStore((s) => s.map?.walls.find((w) => w.id === opening?.wallId));
  const segments = wall ? wallSegmentEnds(wall).length : 1;
  return opening ? (
    <div className="panel">
      <h2>Opening</h2>
      <OpeningFields
        value={opening}
        onChange={(label, patch) =>
          editItem(
            label,
            (d) => d.openings,
            id,
            (o) => Object.assign(o, patch),
          )
        }
      />
      <NumberField
        label="Segment"
        value={opening.segment}
        min={0}
        max={segments - 1}
        step={1}
        title="Wall segment the opening sits on, counted from the first wall point"
        onChange={(segment) =>
          editItem(
            'Opening segment',
            (d) => d.openings,
            id,
            (o) => void (o.segment = Math.round(segment)),
          )
        }
      />
      <NumberField
        label="Position"
        value={opening.t}
        min={0}
        max={1}
        step={0.05}
        title="Center along the segment: 0 = start, 1 = end"
        onChange={(t) =>
          editItem(
            'Move opening',
            (d) => d.openings,
            id,
            (o) => void (o.t = t),
          )
        }
      />
      <DeleteButton label="Delete" onDelete={() => removeItem('Delete opening', (d) => d.openings, id)} />
    </div>
  ) : null;
}

function RoomPanel({ id }: PanelProps) {
  const room = useEditorStore((s) => s.map?.rooms.find((r) => r.id === id));
  return room ? (
    <div className="panel">
      <h2>Room</h2>
      <TextField
        label="Name"
        value={room.name}
        onChange={(name) =>
          editItem(
            'Rename room',
            (d) => d.rooms,
            id,
            (r) => void (r.name = name),
          )
        }
      />
      <RoomFields
        value={room}
        onChange={(label, patch) =>
          editItem(
            label,
            (d) => d.rooms,
            id,
            (r) => Object.assign(r, patch),
          )
        }
      />
      <VertexEditor
        kind="room"
        id={id}
        points={room.polygon}
        onMove={(i, p) =>
          editItem(
            'Move vertex',
            (d) => d.rooms,
            id,
            (r) => void (r.polygon[i] = p),
          )
        }
      />
      <DeleteButton label="Delete" onDelete={() => removeItem('Delete room', (d) => d.rooms, id)} />
    </div>
  ) : null;
}

function RegionPanel({ id }: PanelProps) {
  const region = useEditorStore((s) => s.map?.regions.find((r) => r.id === id));
  return region ? (
    <div className="panel">
      <h2>Region</h2>
      <TextField
        label="Name"
        value={region.name}
        onChange={(name) =>
          editItem(
            'Rename region',
            (d) => d.regions,
            id,
            (r) => void (r.name = name),
          )
        }
      />
      <RegionFields
        value={region}
        onChange={(label, patch) =>
          editItem(
            label,
            (d) => d.regions,
            id,
            (r) => Object.assign(r, patch),
          )
        }
      />
      <TextField
        label="Notes"
        multiline
        value={region.notes}
        onChange={(notes) =>
          editItem(
            'Region notes',
            (d) => d.regions,
            id,
            (r) => void (r.notes = notes),
          )
        }
      />
      <VertexEditor
        kind="region"
        id={id}
        points={region.polygon}
        onMove={(i, p) =>
          editItem(
            'Move vertex',
            (d) => d.regions,
            id,
            (r) => void (r.polygon[i] = p),
          )
        }
      />
      <DeleteButton label="Delete" onDelete={() => removeItem('Delete region', (d) => d.regions, id)} />
    </div>
  ) : null;
}

function LightPanel({ id }: PanelProps) {
  const light = useEditorStore((s) => s.map?.lights.find((l) => l.id === id));
  const move = (label: string, patch: Partial<Vec2 & { elevationFt: number }>) =>
    editItem(
      label,
      (d) => d.lights,
      id,
      (l) => Object.assign(l.position, patch),
    );
  return light ? (
    <div className="panel">
      <h2>Light</h2>
      <TextField
        label="Name"
        value={light.name}
        onChange={(name) =>
          editItem(
            'Rename light',
            (d) => d.lights,
            id,
            (l) => void (l.name = name),
          )
        }
      />
      <LightFields
        value={light}
        onChange={(label, patch) =>
          editItem(
            label,
            (d) => d.lights,
            id,
            (l) => Object.assign(l, patch),
          )
        }
      />
      <NumberField
        label="X"
        value={light.position.x}
        step={0.5}
        suffix="ft"
        onChange={(x) => move('Move light', { x })}
      />
      <NumberField
        label="Y"
        value={light.position.y}
        step={0.5}
        suffix="ft"
        onChange={(y) => move('Move light', { y })}
      />
      <NumberField
        label="Elevation"
        value={light.position.elevationFt}
        step={0.5}
        suffix="ft"
        onChange={(elevationFt) => move('Light elevation', { elevationFt })}
      />
      <TextField
        label="Follows combatant"
        value={light.attachedTo ?? ''}
        placeholder="combatant id, empty = fixed"
        onChange={(v) =>
          editItem(
            'Attach light',
            (d) => d.lights,
            id,
            (l) => void (l.attachedTo = v.trim() === '' ? null : v.trim()),
          )
        }
      />
      <DeleteButton label="Delete" onDelete={() => removeItem('Delete light', (d) => d.lights, id)} />
    </div>
  ) : null;
}

function PropPanel({ id }: PanelProps) {
  const prop = useEditorStore((s) => s.map?.props.find((p) => p.id === id));
  const activeTool = useEditorStore((s) => s.activeTool);
  return prop ? (
    <div className="panel">
      <h2>Prop</h2>
      <TextField
        label="Name"
        value={prop.name}
        onChange={(name) =>
          editItem(
            'Rename prop',
            (d) => d.props,
            id,
            (p) => void (p.name = name),
          )
        }
      />
      <p className="muted">{prop.asset.path}</p>
      {activeTool === 'prop' ? (
        <GizmoModeButtons />
      ) : (
        <button onClick={() => useEditorStore.getState().setTool('prop')}>Move / rotate / scale with gizmo</button>
      )}
      <Vec3Fields
        label="Position"
        value={prop.position}
        onChange={(position) =>
          editItem(
            'Move prop',
            (d) => d.props,
            id,
            (p) => void (p.position = position),
          )
        }
      />
      <Vec3Fields
        label="Rotation °"
        value={prop.rotationDeg}
        onChange={(rotationDeg) =>
          editItem(
            'Rotate prop',
            (d) => d.props,
            id,
            (p) => void (p.rotationDeg = rotationDeg),
          )
        }
      />
      <Vec3Fields
        label="Scale"
        value={prop.scale}
        onChange={(scale) =>
          editItem(
            'Scale prop',
            (d) => d.props,
            id,
            (p) => void (p.scale = scale),
          )
        }
      />
      <CheckboxField
        label="Project map"
        value={prop.projectMap}
        onChange={(projectMap) =>
          editItem(
            'Project map on prop',
            (d) => d.props,
            id,
            (p) => void (p.projectMap = projectMap),
          )
        }
      />
      <CheckboxField
        label="Occludes sight"
        value={prop.occludesSight}
        onChange={(occludesSight) =>
          editItem(
            'Prop occludes sight',
            (d) => d.props,
            id,
            (p) => void (p.occludesSight = occludesSight),
          )
        }
      />
      <CheckboxField
        label="Blocks movement"
        value={prop.blocksMovement}
        onChange={(blocksMovement) =>
          editItem(
            'Prop blocks movement',
            (d) => d.props,
            id,
            (p) => void (p.blocksMovement = blocksMovement),
          )
        }
      />
      <CheckboxField
        label="Walkable"
        value={prop.walkable}
        onChange={(walkable) =>
          editItem(
            'Prop walkable',
            (d) => d.props,
            id,
            (p) => void (p.walkable = walkable),
          )
        }
      />
      <DeleteButton label="Delete" onDelete={() => removeItem('Delete prop', (d) => d.props, id)} />
    </div>
  ) : null;
}

/** Side panel editors for walls, openings, rooms, regions, lights and props. */
export const STRUCTURE_SELECTION_PANELS: Record<NonNullable<Selection>['kind'], ComponentType<PanelProps>> = {
  wall: WallPanel,
  opening: OpeningPanel,
  room: RoomPanel,
  region: RegionPanel,
  light: LightPanel,
  prop: PropPanel,
};
