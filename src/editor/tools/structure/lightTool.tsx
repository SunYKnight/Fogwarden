import { create } from 'zustand';
import { newId, type MapLight, type MapPoint } from '@/core/model';
import { circlePoints } from '@/render/structures/drape';
import { NumberField, SelectField } from '@/ui/components/fields';
import type { EditorTool } from '../../tool';
import { addItem } from './documentEdits';
import { OverlayMarker, OverlayPath } from './drafting';
import { LightFields, type LightTemplate } from './propertyFields';

type Preset = 'torch' | 'lantern' | 'candle' | 'campfire' | 'custom';

const PRESET_IDS: Preset[] = ['torch', 'lantern', 'candle', 'campfire', 'custom'];

/** 5e light sources: bright radius and dim light beyond it. */
const PRESETS: Record<Exclude<Preset, 'custom'>, Pick<MapLight, 'brightFt' | 'dimFt' | 'color'>> = {
  torch: { brightFt: 20, dimFt: 20, color: '#ffb15c' },
  lantern: { brightFt: 30, dimFt: 30, color: '#ffd28a' },
  candle: { brightFt: 5, dimFt: 5, color: '#ffc36b' },
  campfire: { brightFt: 20, dimFt: 20, color: '#ff9a3c' },
};

interface LightToolState extends LightTemplate {
  preset: Preset;
  /** Height of the flame above the clicked surface. */
  heightFt: number;
  cursor: MapPoint | null;
}

const useLightTool = create<LightToolState>(() => ({
  preset: 'torch',
  ...PRESETS.torch,
  enabled: true,
  heightFt: 5,
  cursor: null,
}));

function placeLight(point: MapPoint): void {
  const { preset, brightFt, dimFt, color, enabled, heightFt } = useLightTool.getState();
  const light: MapLight = {
    id: newId(),
    name: preset === 'custom' ? 'Light' : preset[0]!.toUpperCase() + preset.slice(1),
    position: { x: point.x, y: point.y, elevationFt: point.elevationFt + heightFt },
    brightFt,
    dimFt,
    color,
    enabled,
    attachedTo: null,
  };
  addItem('Add light', (d) => d.lights, light, 'light');
}

function LightToolPanel() {
  const state = useLightTool();
  return (
    <>
      <SelectField
        label="Preset"
        value={state.preset}
        options={PRESET_IDS}
        onChange={(preset) => useLightTool.setState(preset === 'custom' ? { preset } : { preset, ...PRESETS[preset] })}
      />
      <LightFields value={state} onChange={(_, patch) => useLightTool.setState({ ...patch, preset: 'custom' })} />
      <NumberField
        label="Height"
        value={state.heightFt}
        min={0}
        step={0.5}
        suffix="ft"
        title="Height of the light above the clicked surface"
        onChange={(heightFt) => useLightTool.setState({ heightFt })}
      />
    </>
  );
}

/** Bulb and radius preview at the cursor. */
function LightToolOverlay() {
  const { cursor, brightFt, dimFt, color } = useLightTool();
  return cursor ? (
    <group>
      <OverlayMarker position={cursor} color={color} size={0.6} />
      <OverlayPath points={circlePoints(cursor, brightFt)} closed color={color} />
      <OverlayPath points={circlePoints(cursor, brightFt + dimFt)} closed color={color} dashed />
    </group>
  ) : null;
}

export const lightTool: EditorTool = {
  id: 'light',
  label: 'Light',
  icon: '✶',
  group: 'scene',
  shortcut: 'l',
  hint: 'Click to place a light; pick a preset or set radii in the side panel',
  onPointer: (event) => {
    if (event.point && event.type === 'move') {
      useLightTool.setState({ cursor: event.point });
    } else if (event.point && event.type === 'down' && event.button === 0) {
      placeLight(event.point);
    }
  },
  Panel: LightToolPanel,
  Overlay: LightToolOverlay,
  deactivate: () => useLightTool.setState({ cursor: null }),
};
