import type { Grid, Vec2 } from '@/core/model';
import { calibrateFromSquare, fitSquaresToImage } from '@/core/terrain/calibration';
import type { HeightField } from '@/core/terrain/heightfield';
import { resampleHeightField } from '@/core/terrain/resample';
import { useMapRender, type MapPointerEvent } from '@/render/mapRenderContext';
import { imagePxToWorld, worldToImagePx } from '@/render/projection';
import { useEditorStore } from '@/state/editorStore';
import { CheckboxField, ColorField, Field, NumberField, SliderField } from '@/ui/components/fields';
import { Button, Section, useShortcuts } from '@/ui/kit';
import type { EditorTool } from '../../tool';
import { OverlayLines, overlayPositions } from './overlays';
import { editorTerrain } from './sculpt';
import { useTerrainToolStore } from './terrainToolStore';

/** Smaller drags count as a click; smaller squares are misclicks. */
const MIN_SQUARE_PX = 6;
/** Squares of the candidate grid drawn to each side of the picked square. */
const PREVIEW_SQUARES = 8;

// Corner one comes from the press; a release elsewhere drags a square.
let dragging = false;
// Tool to return to once a pick started from the map settings ends.
let returnTool = 'select';

function roundTo(value: number, digits: number): number {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

/** Hides the map settings and lets the user pick a grid square on the map. */
export function startGridPick(): void {
  const editor = useEditorStore.getState();
  returnTool = editor.activeTool === 'calibrate' ? returnTool : editor.activeTool;
  editor.setSettingsOpen(false);
  editor.setTool('calibrate');
}

/** Back to the tool used before the pick, with the map settings showing the result. */
function endGridPick(): void {
  const editor = useEditorStore.getState();
  editor.setTool(returnTool);
  editor.setSettingsOpen(true);
}

function openGrid(): Grid {
  const map = useEditorStore.getState().map;
  if (!map) {
    throw new Error('No map is open in the editor');
  }
  return map.grid;
}

function candidateGrid(grid: Grid, a: Vec2, b: Vec2, detectRotation: boolean): Grid {
  return { ...grid, ...calibrateFromSquare(a, b, detectRotation ? null : grid.rotationDeg) };
}

function calibrate(a: Vec2, b: Vec2): void {
  const next = candidateGrid(openGrid(), a, b, useTerrainToolStore.getState().detectRotation);
  if (next.pxPerSquare < MIN_SQUARE_PX) {
    throw new Error('Click two opposite corners of one grid square in the image');
  }
  useEditorStore.getState().edit('Calibrate grid', (d) => {
    d.grid.pxPerSquare = roundTo(next.pxPerSquare, 3);
    d.grid.rotationDeg = roundTo(next.rotationDeg, 3);
    d.grid.offsetPx = { x: roundTo(next.offsetPx.x, 2), y: roundTo(next.offsetPx.y, 2) };
  });
  endGridPick();
}

/** Changes grid size or terrain resolution; heights are resampled so they stay where they were in feet. */
function regrid(label: string, patch: Partial<Pick<Grid, 'squaresX' | 'squaresY' | 'feetPerSquare'>>, sps: number) {
  const next = resampleHeightField(editorTerrain(), { ...openGrid(), ...patch }, sps);
  useEditorStore.getState().replaceTerrain(label, next, (d) => {
    Object.assign(d.grid, patch);
    d.terrain.samplesPerSquare = sps;
  });
}

function calibratePointer(event: MapPointerEvent): void {
  const tools = useTerrainToolStore.getState();
  if (event.point) {
    tools.setCursor(event.point);
  }
  const px = event.point && worldToImagePx(openGrid(), event.point);
  const first = tools.cornerPx;
  if (event.type === 'down' && px && first) {
    tools.setCornerPx(null);
    dragging = false;
    calibrate(first, px);
  } else if (event.type === 'down' && px) {
    tools.setCornerPx(px);
    dragging = true;
  } else if (event.type === 'up') {
    const dragged = dragging && px && first && Math.hypot(px.x - first.x, px.y - first.y) >= MIN_SQUARE_PX;
    dragging = false;
    if (dragged) {
      tools.setCornerPx(null);
      calibrate(first, px);
    }
  }
}

/** Lines of the grid the clicked corners would produce, around the picked square, draped on the terrain. */
function previewLines(grid: Grid, terrain: HeightField, first: Vec2, second: Vec2, detectRotation: boolean) {
  const next = candidateGrid(grid, first, second, detectRotation);
  const fps = grid.feetPerSquare;
  // Candidate square coords -> image px -> map plane (current grid).
  const toWorld = (u: number, v: number) => imagePxToWorld(grid, worldToImagePx(next, { x: u * fps, y: v * fps }));
  const center = imagePxToWorld(next, { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
  const i0 = Math.floor(center.x / fps);
  const j0 = Math.floor(center.y / fps);
  const heightAt = (p: Vec2) => terrain.sample(p.x, p.y);
  const lo = -PREVIEW_SQUARES;
  const hi = PREVIEW_SQUARES + 1;
  const all: number[] = [];
  for (let k = lo; k <= hi; k++) {
    all.push(...overlayPositions([toWorld(i0 + k, j0 + lo), toWorld(i0 + k, j0 + hi)], false, fps / 4, heightAt));
    all.push(...overlayPositions([toWorld(i0 + lo, j0 + k), toWorld(i0 + hi, j0 + k)], false, fps / 4, heightAt));
  }
  const square = [toWorld(i0, j0), toWorld(i0 + 1, j0), toWorld(i0 + 1, j0 + 1), toWorld(i0, j0 + 1)];
  return { all: new Float32Array(all), picked: overlayPositions(square, true, fps / 4, heightAt) };
}

// Rebuilt every render, like the brush cursor: the field is mutated in place.
function CalibrationPreview() {
  const { map, terrain } = useMapRender();
  const first = useTerrainToolStore((s) => s.cornerPx);
  const cursor = useTerrainToolStore((s) => s.cursor);
  const detectRotation = useTerrainToolStore((s) => s.detectRotation);
  const second = cursor && worldToImagePx(map.grid, cursor);
  const square = first && second && Math.hypot(second.x - first.x, second.y - first.y) >= MIN_SQUARE_PX;
  const lines = square && previewLines(map.grid, terrain, first, second, detectRotation);
  return (
    lines && (
      <>
        <OverlayLines positions={lines.all} color="#7fd4ff" />
        <OverlayLines positions={lines.picked} color="#ffd54a" />
      </>
    )
  );
}

/** Grid display, calibration numbers and size; the grid section of the map settings. */
export function GridFields() {
  const map = useEditorStore((s) => s.map);
  if (!map) {
    throw new Error('GridFields needs an open map');
  }
  const { grid, image } = map;
  const sps = map.terrain.samplesPerSquare;
  const edit = useEditorStore.getState().edit;
  const fit = image && fitSquaresToImage(image, grid.pxPerSquare);
  const fits = !fit || (fit.squaresX === grid.squaresX && fit.squaresY === grid.squaresY);
  return (
    <>
      <div className="row wrap">
        <Button
          icon="calibrate"
          label="Pick a square on the map"
          title="Click two opposite corners of one grid square in the image, or drag across one"
          onClick={startGridPick}
        />
        <Button
          icon="image"
          label="Fit grid to image"
          disabled={fits}
          title="Squares = image size / px per square"
          onClick={() => fit && regrid('Fit grid to image', fit, sps)}
        />
      </div>
      <CheckboxField
        label="Show grid"
        value={grid.show}
        onChange={(v) => edit('Toggle grid', (d) => void (d.grid.show = v))}
      />
      <ColorField
        label="Grid color"
        value={grid.color}
        onChange={(v) => edit('Grid color', (d) => void (d.grid.color = v))}
      />
      <SliderField
        label="Grid opacity"
        value={grid.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => edit('Grid opacity', (d) => void (d.grid.opacity = v))}
      />
      <Section title="Advanced" collapsible defaultOpen={false}>
        <NumberField
          label="Px per square"
          value={grid.pxPerSquare}
          min={1}
          step={0.1}
          onChange={(v) => edit('Px per square', (d) => void (d.grid.pxPerSquare = v))}
        />
        <NumberField
          label="Offset X"
          value={grid.offsetPx.x}
          step={0.5}
          suffix="px"
          onChange={(v) => edit('Grid offset', (d) => void (d.grid.offsetPx.x = v))}
        />
        <NumberField
          label="Offset Y"
          value={grid.offsetPx.y}
          step={0.5}
          suffix="px"
          onChange={(v) => edit('Grid offset', (d) => void (d.grid.offsetPx.y = v))}
        />
        <NumberField
          label="Rotation"
          value={grid.rotationDeg}
          step={0.1}
          suffix="°"
          onChange={(v) => edit('Grid rotation', (d) => void (d.grid.rotationDeg = v))}
        />
        <NumberField
          label="Squares X"
          value={grid.squaresX}
          min={1}
          max={1000}
          step={1}
          onChange={(v) => regrid('Grid size', { squaresX: Math.round(v) }, sps)}
        />
        <NumberField
          label="Squares Y"
          value={grid.squaresY}
          min={1}
          max={1000}
          step={1}
          onChange={(v) => regrid('Grid size', { squaresY: Math.round(v) }, sps)}
        />
        <NumberField
          label="Feet per square"
          value={grid.feetPerSquare}
          min={0.5}
          step={0.5}
          suffix="ft"
          onChange={(v) => regrid('Feet per square', { feetPerSquare: v }, sps)}
        />
        <NumberField
          label="Samples per square"
          value={sps}
          min={1}
          max={8}
          step={1}
          title="Terrain height samples along each square edge; more allows finer sculpting"
          onChange={(v) => regrid('Terrain resolution', {}, Math.round(v))}
        />
      </Section>
    </>
  );
}

/** Inline options while picking: readouts, rotation detection and the way back to the settings. */
function CalibratePickBar() {
  const map = useEditorStore((s) => s.map);
  const cursor = useTerrainToolStore((s) => s.cursor);
  const first = useTerrainToolStore((s) => s.cornerPx);
  const detectRotation = useTerrainToolStore((s) => s.detectRotation);
  useShortcuts('Map editor: grid pick', [
    {
      keys: 'Escape',
      label: 'Drop the picked corner, else back to the map settings',
      run: () => {
        const tools = useTerrainToolStore.getState();
        if (tools.cornerPx) tools.setCornerPx(null);
        else endGridPick();
      },
    },
  ]);
  const px = map && cursor && worldToImagePx(map.grid, cursor);
  return (
    <>
      <Field label="Image px">
        <span>{px ? `${px.x.toFixed(1)}, ${px.y.toFixed(1)}` : '–'}</span>
      </Field>
      <Field label="First corner">
        <span>{first ? `${first.x.toFixed(1)}, ${first.y.toFixed(1)}` : '–'}</span>
      </Field>
      <CheckboxField
        label="Detect rotation"
        value={detectRotation}
        onChange={(v) => useTerrainToolStore.getState().setOptions({ detectRotation: v })}
      />
      <Button icon="settings" label="Back to map settings" onClick={endGridPick} />
    </>
  );
}

export const calibrateTool: EditorTool = {
  id: 'calibrate',
  label: 'Calibrate grid',
  icon: 'calibrate',
  hint: 'Click two opposite corners of one grid square in the image, or drag across one; Esc goes back',
  cursor: 'crosshair',
  onPointer: calibratePointer,
  Panel: CalibratePickBar,
  Overlay: CalibrationPreview,
  deactivate: () => {
    dragging = false;
    useTerrainToolStore.getState().setCornerPx(null);
    useTerrainToolStore.getState().setCursor(null);
  },
};
