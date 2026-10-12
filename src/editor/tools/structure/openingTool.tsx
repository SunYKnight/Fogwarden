import { create } from 'zustand';
import { newId, type Opening } from '@/core/model';
import { nearestWallSegment, type WallHit } from '@/core/geometry/wallEdit';
import { distance2, lerp2, wallSegmentEnds } from '@/core/geometry/walls';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { useAppStore } from '@/state/appStore';
import { useEditorStore } from '@/state/editorStore';
import type { EditorTool } from '../../tool';
import { addItem, editorMap } from './documentEdits';
import { OverlayMarker, OverlayPath } from './drafting';
import { OPENING_DEFAULTS, OpeningFields, type OpeningTemplate } from './propertyFields';

// One grid square: zoomed out, a wall is only a few pixels wide and its
// points snap to corners, so a tighter range makes doors hard to place.
const PICK_DISTANCE_FT = 5;

const useOpeningTemplate = create<OpeningTemplate>(() => ({
  kind: 'door',
  ...OPENING_DEFAULTS.door,
  state: 'closed',
  secret: false,
}));

const useOpeningPreview = create<{ hit: WallHit | null }>(() => ({ hit: null }));

function wallHitAt(event: MapPointerEvent): WallHit | null {
  const map = editorMap();
  const clicked = event.hit?.kind === 'wall' ? map.walls.filter((w) => w.id === event.hit?.id) : map.walls;
  return event.point ? nearestWallSegment(event.point, clicked, PICK_DISTANCE_FT) : null;
}

function placeOpening(event: MapPointerEvent): void {
  const hit = wallHitAt(event);
  if (hit) {
    const opening: Opening = {
      ...useOpeningTemplate.getState(),
      id: newId(),
      wallId: hit.wallId,
      segment: hit.segment,
      t: hit.t,
    };
    addItem('Add opening', (d) => d.openings, opening, 'opening');
  } else {
    // A miss is guidance, not a failure: the preview shows where it would go.
    useAppStore.getState().notify('Click closer to a wall: the blue mark shows where the door goes', 'info');
  }
}

function OpeningToolPanel() {
  const template = useOpeningTemplate();
  return (
    <OpeningFields
      value={template}
      onChange={(_, patch) =>
        useOpeningTemplate.setState(patch.kind ? { ...patch, ...OPENING_DEFAULTS[patch.kind] } : patch)
      }
    />
  );
}

/** Where the opening would go: its span along the wall under the cursor. */
function OpeningToolOverlay() {
  const hit = useOpeningPreview((s) => s.hit);
  const widthFt = useOpeningTemplate((s) => s.widthFt);
  const wall = useEditorStore((s) => s.map?.walls.find((w) => w.id === hit?.wallId));
  const ends = wall && hit ? wallSegmentEnds(wall)[hit.segment] : undefined;
  const half = ends ? widthFt / 2 / Math.max(distance2(ends[0], ends[1]), 1e-6) : 0;
  return hit && ends ? (
    <group>
      <OverlayPath
        points={[
          lerp2(ends[0], ends[1], Math.max(0, hit.t - half)),
          lerp2(ends[0], ends[1], Math.min(1, hit.t + half)),
        ]}
        closed={false}
        color="#4ad6ff"
      />
      <OverlayMarker position={hit.point} color="#4ad6ff" size={0.3} />
    </group>
  ) : null;
}

export const openingTool: EditorTool = {
  id: 'opening',
  label: 'Door / window',
  icon: 'door',
  step: 'walls',
  shortcut: 'd',
  hint: 'Click on a wall to place a door, window, portcullis or arrow slit there',
  cursor: 'crosshair',
  onPointer: (event) => {
    if (event.type === 'move') {
      useOpeningPreview.setState({ hit: wallHitAt(event) });
    } else if (event.type === 'down' && event.button === 0) {
      placeOpening(event);
    }
  },
  Panel: OpeningToolPanel,
  Overlay: OpeningToolOverlay,
  deactivate: () => useOpeningPreview.setState({ hit: null }),
};
