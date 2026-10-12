import { create } from 'zustand';
import { newId, type Wall } from '@/core/model';
import { CheckboxField } from '@/ui/components/fields';
import type { EditorTool } from '../../tool';
import { addItem } from './documentEdits';
import { DraftControls, DraftOverlay, draftPointer, resetDraft, useDraftKeys, type DraftActions } from './drafting';
import { WallFields, type WallTemplate } from './propertyFields';

const useWallTemplate = create<WallTemplate & { closed: boolean }>(() => ({
  closed: false,
  heightFt: 10,
  thicknessFt: 1,
  baseFt: null,
  material: 'stone',
  blocksSight: true,
  blocksMovement: true,
  blocksLight: true,
}));

const WALL_DRAFT: DraftActions = {
  minPoints: 2,
  finish: (points, closedByClick) => {
    const template = useWallTemplate.getState();
    const wall: Wall = {
      ...template,
      id: newId(),
      points,
      closed: (template.closed || closedByClick) && points.length > 2,
    };
    addItem('Add wall', (d) => d.walls, wall, 'wall');
  },
};

function WallToolPanel() {
  const template = useWallTemplate();
  useDraftKeys(WALL_DRAFT);
  return (
    <>
      <DraftControls actions={WALL_DRAFT} />
      <CheckboxField
        label="Closed"
        value={template.closed}
        onChange={(closed) => useWallTemplate.setState({ closed })}
      />
      <WallFields value={template} onChange={(_, patch) => useWallTemplate.setState(patch)} />
    </>
  );
}

function WallToolOverlay() {
  const closed = useWallTemplate((s) => s.closed);
  return <DraftOverlay closed={closed} color="#ff9f43" />;
}

export const wallTool: EditorTool = {
  id: 'wall',
  label: 'Wall',
  icon: 'wall',
  step: 'walls',
  shortcut: 'w',
  hint:
    'Click wall points (snaps to vertices, corners, edge midpoints; Shift = free). ' +
    'Double-click, Enter or the first point finishes; Esc cancels',
  cursor: 'crosshair',
  onPointer: (event) => draftPointer(event, WALL_DRAFT),
  Panel: WallToolPanel,
  Overlay: WallToolOverlay,
  deactivate: resetDraft,
};
