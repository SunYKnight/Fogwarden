import { create } from 'zustand';
import { newId, type Region } from '@/core/model';
import type { EditorTool } from '../../tool';
import { addItem } from './documentEdits';
import { DraftControls, DraftOverlay, draftPointer, resetDraft, useDraftKeys, type DraftActions } from './drafting';
import { REGION_COLORS, RegionFields, type RegionTemplate } from './propertyFields';

// The default kind is a dark area: the most common region on dungeon maps.
const useRegionTemplate = create<RegionTemplate>(() => ({
  kind: 'light',
  light: 'darkness',
  color: REGION_COLORS.light,
  hiddenFromPlayers: false,
  sound: null,
}));

const REGION_DRAFT: DraftActions = {
  minPoints: 3,
  finish: (points) => {
    const template = useRegionTemplate.getState();
    const region: Region = {
      ...template,
      id: newId(),
      name: template.kind === 'light' ? `${template.light ?? 'light'} area` : `${template.kind} area`,
      polygon: points,
      notes: '',
    };
    addItem('Add region', (d) => d.regions, region, 'region');
  },
};

function RegionToolPanel() {
  const template = useRegionTemplate();
  useDraftKeys(REGION_DRAFT);
  return (
    <>
      <DraftControls actions={REGION_DRAFT} />
      <RegionFields value={template} onChange={(_, patch) => useRegionTemplate.setState(patch)} />
    </>
  );
}

function RegionToolOverlay() {
  const color = useRegionTemplate((s) => s.color);
  return <DraftOverlay closed color={color} />;
}

export const regionTool: EditorTool = {
  id: 'region',
  label: 'Region',
  icon: 'region',
  step: 'areas',
  shortcut: 'g',
  hint: 'Click polygon points (Shift = no snapping); double-click, Enter or the first point finishes; Esc cancels',
  cursor: 'crosshair',
  onPointer: (event) => draftPointer(event, REGION_DRAFT),
  Panel: RegionToolPanel,
  Overlay: RegionToolOverlay,
  deactivate: resetDraft,
};
