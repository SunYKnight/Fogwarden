import { beforeEach, describe, expect, it } from 'vitest';
import { createMap } from '@/core/model';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { takeTerrainDirty } from '@/render/terrain/terrainDirty';
import { useEditorStore } from '@/state/editorStore';
import type { EditorTool } from '../../tool';
import { calibrateTool } from './calibrate';
import { rampTool } from './ramp';
import { raiseTool, smoothTool } from './sculpt';
import { useTerrainToolStore } from './terrainToolStore';

function pointer(type: MapPointerEvent['type'], x: number | null, y = 0, altKey = false): MapPointerEvent {
  return {
    type,
    point: x === null ? null : { x, y, elevationFt: 0 },
    hit: null,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey,
  };
}

function drag(tool: EditorTool, from: [number, number], to: [number, number], moves: number) {
  tool.onPointer!(pointer('down', ...from));
  for (let k = 1; k <= moves; k++) {
    const t = k / moves;
    tool.onPointer!(pointer('move', from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t));
  }
  tool.onPointer!(pointer('up', null));
}

function terrain() {
  return useEditorStore.getState().terrain!;
}

describe('terrain tools', () => {
  beforeEach(() => {
    const map = createMap({ name: 'm', image: null, squaresX: 10, squaresY: 10, pxPerSquare: 70 });
    useEditorStore.getState().open(map);
    useTerrainToolStore.setState({ radiusFt: 5, strength: 1, falloff: 'smooth', rampStart: null, cornerPx: null });
    const field = terrain();
    field.data.forEach((_, i) => (field.data[i] = Math.sin(i) * 3));
  });

  it('undo after a stroke restores the exact heights', () => {
    const before = terrain().data.slice();
    drag(raiseTool, [10, 10], [40, 30], 7);
    expect(terrain().data).not.toEqual(before);
    useEditorStore.getState().undo();
    expect(terrain().data).toEqual(before);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });

  it('ends the stroke when the button is released outside the canvas', () => {
    drag(smoothTool, [20, 20], [30, 20], 3);
    expect(useEditorStore.getState().canUndo).toBe(true);
    const afterStroke = terrain().data.slice();
    raiseTool.onPointer!(pointer('move', 25, 25));
    expect(terrain().data).toEqual(afterStroke);
  });

  it('applies the same amount however many pointer events a drag produces', () => {
    const before = terrain().data.slice();
    drag(raiseTool, [10, 10], [40, 10], 2);
    const few = terrain().data.slice();
    useEditorStore.getState().undo();
    drag(raiseTool, [10, 10], [40, 10], 60);
    const many = terrain().data;
    expect(Math.max(...many.map((h, i) => Math.abs(h - few[i]!)))).toBeLessThan(1e-4);
    expect(Math.max(...many.map((h, i) => Math.abs(h - before[i]!)))).toBeGreaterThan(1);
  });

  it('marks exactly one dirty region per terrain version bump', () => {
    const version = useEditorStore.getState().terrainVersion;
    drag(raiseTool, [10, 10], [20, 10], 4);
    const dirty = takeTerrainDirty(terrain());
    expect(dirty?.changes).toBe(useEditorStore.getState().terrainVersion - version);
  });

  it('ramps between the heights at both ends as one undoable step', () => {
    const field = terrain();
    field.data.fill(0);
    field.data[field.index(40, 20)] = 8;
    rampTool.onPointer!(pointer('down', 10, 25));
    rampTool.onPointer!(pointer('move', 50, 25));
    rampTool.onPointer!(pointer('up', 50, 25));
    expect(field.sample(30, 25)).toBeCloseTo(field.sample(50, 25) / 2, 6);
    expect(field.sample(50, 25)).toBeGreaterThan(0);
    useEditorStore.getState().undo();
    expect(field.sample(30, 25)).toBe(0);
  });

  it('calibrates the grid from two clicked corners', () => {
    // Default grid: 70 px per 5 ft square, so (x, y) ft is px (14x, 14y).
    calibrateTool.onPointer!(pointer('down', 10, 10));
    calibrateTool.onPointer!(pointer('up', 10, 10));
    calibrateTool.onPointer!(pointer('down', 13, 13));
    const grid = useEditorStore.getState().map!.grid;
    expect(grid.pxPerSquare).toBeCloseTo(42, 3);
    expect(grid.offsetPx).toEqual({ x: 14, y: 14 });
  });

  it('calibrates the grid from a drag across one square', () => {
    drag(calibrateTool, [10, 10], [13, 13], 3);
    const grid = useEditorStore.getState().map!.grid;
    expect(grid.pxPerSquare).toBeCloseTo(42, 3);
    expect(useTerrainToolStore.getState().cornerPx).toBeNull();
  });
});
