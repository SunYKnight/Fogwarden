import type { Vec2 } from '@/core/model';
import { rampBrush } from '@/core/terrain/brushes';
import type { HeightField } from '@/core/terrain/heightfield';
import { useMapRender } from '@/render/mapRenderContext';
import { useEditorStore } from '@/state/editorStore';
import type { EditorTool } from '../../tool';
import { BrushCursor, OverlayLines, overlayPositions } from './overlays';
import { commitTerrainRegion, editorTerrain, pickHeight, SculptPanel } from './sculpt';
import { useTerrainToolStore } from './terrainToolStore';

/** Outline of the ramp surface: its sides at the slope it will get. */
function rampOutline(terrain: HeightField, start: Vec2, end: Vec2, radiusFt: number): Float32Array | null {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  let result: Float32Array | null = null;
  if (length > 0) {
    const dx = (end.x - start.x) / length;
    const dy = (end.y - start.y) / length;
    const side = { x: -dy * radiusFt, y: dx * radiusFt };
    const from = terrain.sample(start.x, start.y);
    const to = terrain.sample(end.x, end.y);
    const slope = (p: Vec2) => from + ((to - from) * ((p.x - start.x) * dx + (p.y - start.y) * dy)) / length;
    const corners = [
      { x: start.x + side.x, y: start.y + side.y },
      { x: end.x + side.x, y: end.y + side.y },
      { x: end.x - side.x, y: end.y - side.y },
      { x: start.x - side.x, y: start.y - side.y },
    ];
    result = overlayPositions(corners, true, terrain.spacingFt, slope);
  }
  return result;
}

// Rebuilt every render, like the brush cursor: the field is mutated in place.
function RampPreview() {
  const { terrain } = useMapRender();
  const start = useTerrainToolStore((s) => s.rampStart);
  const end = useTerrainToolStore((s) => s.cursor);
  const radiusFt = useTerrainToolStore((s) => s.radiusFt);
  const positions = start && end && rampOutline(terrain, start, end, radiusFt);
  return positions && <OverlayLines positions={positions} color="#7fd4ff" />;
}

function RampOverlay() {
  return (
    <>
      <BrushCursor />
      <RampPreview />
    </>
  );
}

export const rampTool: EditorTool = {
  id: 'ramp',
  label: 'Ramp',
  icon: '⟋',
  group: 'terrain',
  shortcut: '5',
  hint: 'Drag from one end to the other: straight slope between the heights there, one radius to each side',
  onPointer: (event) => {
    const tools = useTerrainToolStore.getState();
    if (event.point) {
      tools.setCursor(event.point);
    }
    if (event.type === 'down' && event.point && event.altKey) {
      pickHeight(editorTerrain(), event.point);
    } else if (event.type === 'down' && event.point) {
      tools.setRampStart({ x: event.point.x, y: event.point.y });
    } else if (event.type === 'up' && tools.rampStart) {
      // Released outside the canvas: the last point over the map ends the ramp.
      const end = event.point ?? tools.cursor;
      const start = tools.rampStart;
      tools.setRampStart(null);
      if (end && (end.x !== start.x || end.y !== start.y)) {
        const field = editorTerrain();
        const editor = useEditorStore.getState();
        editor.beginTerrainStroke();
        const rect = rampBrush(
          field,
          start,
          end,
          field.sample(start.x, start.y),
          field.sample(end.x, end.y),
          { radiusFt: tools.radiusFt, falloff: tools.falloff },
          tools.strength,
        );
        commitTerrainRegion(field, rect);
        editor.endTerrainStroke('Ramp');
      }
    }
  },
  Panel: SculptPanel,
  Overlay: RampOverlay,
  deactivate: () => {
    useTerrainToolStore.getState().setRampStart(null);
    useTerrainToolStore.getState().setCursor(null);
  },
};
