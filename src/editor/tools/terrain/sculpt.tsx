import type { ReactNode } from 'react';
import type { Vec2 } from '@/core/model';
import {
  FALLOFFS,
  flattenBrush,
  noiseBrush,
  raiseBrush,
  smoothBrush,
  strokeDabs,
  terraceBrush,
  unionRect,
  type Brush,
  type SampleRect,
} from '@/core/terrain/brushes';
import type { HeightField } from '@/core/terrain/heightfield';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { markTerrainDirty } from '@/render/terrain/terrainDirty';
import { useEditorStore } from '@/state/editorStore';
import { CheckboxField, NumberField, SelectField, SliderField } from '@/ui/components/fields';
import type { IconName } from '@/ui/kit';
import type { EditorTool } from '../../tool';
import { BrushCursor } from './overlays';
import { useTerrainToolStore, type TerrainToolOptions } from './terrainToolStore';

/** Height change at the brush center per dab at strength 1 (raise, lower, noise). */
const RAISE_FT_PER_DAB = 1;
/** Dab distance as a fraction of the brush radius. */
const DAB_SPACING = 0.25;

interface SculptSpec {
  id: string;
  label: string;
  icon: IconName;
  shortcut: string;
  hint: string;
  dab(field: HeightField, brush: Brush, options: TerrainToolOptions, startHeightFt: number): SampleRect | null;
  options?: () => ReactNode;
}

interface Stroke {
  label: string;
  last: Vec2;
  startHeightFt: number;
}

// One pointer drives at most one stroke, whichever sculpt tool started it.
let stroke: Stroke | null = null;

export function editorTerrain(): HeightField {
  const terrain = useEditorStore.getState().terrain;
  if (!terrain) {
    throw new Error('No map is open in the editor');
  }
  return terrain;
}

/** Tells the mesh which samples changed, then bumps the terrain version. */
export function commitTerrainRegion(field: HeightField, rect: SampleRect | null): void {
  if (rect) {
    markTerrainDirty(field, rect);
    useEditorStore.getState().terrainChanged();
  }
}

function endStroke(): void {
  if (stroke) {
    useEditorStore.getState().endTerrainStroke(stroke.label);
    stroke = null;
  }
}

/** Alt+click with any sculpt tool stores the height under the pointer as the flatten height. */
export function pickHeight(field: HeightField, point: Vec2): void {
  const height = Math.round(field.sample(point.x, point.y) * 100) / 100;
  useTerrainToolStore.getState().setOptions({ flattenHeightFt: height, flattenToTyped: true });
}

function applyDabs(spec: SculptSpec, field: HeightField, centers: Vec2[], startHeightFt: number): void {
  const options = useTerrainToolStore.getState();
  let rect: SampleRect | null = null;
  for (const center of centers) {
    const brush = { center, radiusFt: options.radiusFt, falloff: options.falloff };
    rect = unionRect(rect, spec.dab(field, brush, options, startHeightFt));
  }
  commitTerrainRegion(field, rect);
}

function sculptPointer(spec: SculptSpec, event: MapPointerEvent): void {
  const tools = useTerrainToolStore.getState();
  const point = event.point && { x: event.point.x, y: event.point.y };
  if (event.point) {
    tools.setCursor(event.point);
  }
  if (event.type === 'down' && point && event.altKey) {
    pickHeight(editorTerrain(), point);
  } else if (event.type === 'down' && point) {
    endStroke();
    const field = editorTerrain();
    useEditorStore.getState().beginTerrainStroke();
    stroke = { label: spec.label, last: point, startHeightFt: field.sample(point.x, point.y) };
    applyDabs(spec, field, [point], stroke.startHeightFt);
  } else if (event.type === 'move' && point && stroke) {
    const field = editorTerrain();
    const dabs = strokeDabs(stroke.last, point, Math.max(tools.radiusFt * DAB_SPACING, field.spacingFt / 2));
    if (dabs.length > 0) {
      stroke.last = dabs[dabs.length - 1]!;
      applyDabs(spec, field, dabs, stroke.startHeightFt);
    }
  } else if (event.type === 'up') {
    endStroke();
  }
}

/** Brush options shared by every sculpt tool, plus the tool's own fields. */
export function SculptPanel({ children }: { children?: ReactNode }) {
  const radiusFt = useTerrainToolStore((s) => s.radiusFt);
  const strength = useTerrainToolStore((s) => s.strength);
  const falloff = useTerrainToolStore((s) => s.falloff);
  const { setOptions } = useTerrainToolStore.getState();
  return (
    <>
      <SliderField
        label="Radius"
        value={radiusFt}
        min={1}
        max={60}
        step={1}
        suffix=" ft"
        onChange={(v) => setOptions({ radiusFt: v })}
      />
      <SliderField
        label="Strength"
        value={strength}
        min={0.05}
        max={1}
        step={0.05}
        onChange={(v) => setOptions({ strength: v })}
      />
      <SelectField label="Falloff" value={falloff} options={FALLOFFS} onChange={(v) => setOptions({ falloff: v })} />
      {children}
    </>
  );
}

function FlattenOptions() {
  const flattenToTyped = useTerrainToolStore((s) => s.flattenToTyped);
  const flattenHeightFt = useTerrainToolStore((s) => s.flattenHeightFt);
  const { setOptions } = useTerrainToolStore.getState();
  return (
    <>
      <CheckboxField
        label="Use typed height"
        value={flattenToTyped}
        onChange={(v) => setOptions({ flattenToTyped: v })}
      />
      <NumberField
        label="Height"
        value={flattenHeightFt}
        step={0.5}
        suffix="ft"
        title="Alt+click on the map picks the height under the pointer"
        onChange={(v) => setOptions({ flattenHeightFt: v })}
      />
    </>
  );
}

function TerraceOptions() {
  const terraceStepFt = useTerrainToolStore((s) => s.terraceStepFt);
  return (
    <NumberField
      label="Step"
      value={terraceStepFt}
      min={0.5}
      step={0.5}
      suffix="ft"
      onChange={(v) => useTerrainToolStore.getState().setOptions({ terraceStepFt: v })}
    />
  );
}

function NoiseOptions() {
  const noiseSeed = useTerrainToolStore((s) => s.noiseSeed);
  const noiseScaleFt = useTerrainToolStore((s) => s.noiseScaleFt);
  const { setOptions } = useTerrainToolStore.getState();
  return (
    <>
      <NumberField label="Seed" value={noiseSeed} step={1} onChange={(v) => setOptions({ noiseSeed: Math.round(v) })} />
      <NumberField
        label="Feature size"
        value={noiseScaleFt}
        min={1}
        step={1}
        suffix="ft"
        onChange={(v) => setOptions({ noiseScaleFt: v })}
      />
    </>
  );
}

function sculptTool(spec: SculptSpec): EditorTool {
  const Options = spec.options;
  return {
    id: spec.id,
    label: spec.label,
    icon: spec.icon,
    step: 'ground',
    shortcut: spec.shortcut,
    hint: spec.hint,
    cursor: 'none',
    onPointer: (event) => sculptPointer(spec, event),
    Panel: () => <SculptPanel>{Options && <Options />}</SculptPanel>,
    Overlay: BrushCursor,
    deactivate: () => {
      endStroke();
      useTerrainToolStore.getState().setCursor(null);
    },
  };
}

const PICK_HINT = 'Alt+click picks the flatten height';

export const raiseTool = sculptTool({
  id: 'raise',
  label: 'Raise',
  icon: 'raise',
  shortcut: 'e',
  hint: `Drag to raise the terrain · ${PICK_HINT}`,
  dab: (field, brush, options) => raiseBrush(field, brush, options.strength * RAISE_FT_PER_DAB),
});

export const lowerTool = sculptTool({
  id: 'lower',
  label: 'Lower',
  icon: 'lower',
  shortcut: 'q',
  hint: `Drag to lower the terrain · ${PICK_HINT}`,
  dab: (field, brush, options) => raiseBrush(field, brush, -options.strength * RAISE_FT_PER_DAB),
});

export const smoothTool = sculptTool({
  id: 'smooth',
  label: 'Smooth',
  icon: 'smooth',
  shortcut: 's',
  hint: `Drag to smooth bumps and edges · ${PICK_HINT}`,
  dab: (field, brush, options) => smoothBrush(field, brush, options.strength),
});

export const flattenTool = sculptTool({
  id: 'flatten',
  label: 'Flatten',
  icon: 'flatten',
  shortcut: 'f',
  hint: `Drag to flatten to the height at the stroke start (or the typed height) · ${PICK_HINT}`,
  dab: (field, brush, options, startHeightFt) =>
    flattenBrush(field, brush, options.flattenToTyped ? options.flattenHeightFt : startHeightFt, options.strength),
  options: FlattenOptions,
});

export const terraceTool = sculptTool({
  id: 'terrace',
  label: 'Terrace',
  icon: 'terrace',
  shortcut: 'c',
  hint: `Drag to snap heights to steps; full strength makes cliffs · ${PICK_HINT}`,
  dab: (field, brush, options) => terraceBrush(field, brush, options.terraceStepFt, options.strength),
  options: TerraceOptions,
});

export const noiseTool = sculptTool({
  id: 'noise',
  label: 'Noise',
  icon: 'noise',
  shortcut: 'n',
  hint: `Drag to add rough ground; the same seed gives the same pattern · ${PICK_HINT}`,
  dab: (field, brush, options) =>
    noiseBrush(field, brush, options.strength * RAISE_FT_PER_DAB, options.noiseScaleFt, options.noiseSeed),
  options: NoiseOptions,
});
