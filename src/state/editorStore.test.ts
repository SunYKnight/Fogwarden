import { beforeEach, describe, expect, it } from 'vitest';
import { createMap } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { useEditorStore } from './editorStore';

function openSmallMap() {
  const map = createMap({ name: 'm', image: null, squaresX: 2, squaresY: 2, pxPerSquare: 70 });
  useEditorStore.getState().open(map);
}

function stroke(index: number, height: number) {
  const editor = useEditorStore.getState();
  editor.beginTerrainStroke();
  editor.terrain!.data[index] = height;
  editor.terrainChanged();
  editor.endTerrainStroke('Raise');
}

describe('editor history', () => {
  beforeEach(openSmallMap);

  it('undoes and redoes sculpt strokes', () => {
    stroke(5, 3);
    stroke(5, 8);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().terrain!.data[5]).toBe(3);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().terrain!.data[5]).toBe(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().terrain!.data[5]).toBe(3);
  });

  it('restores sculpted heights when a later terrain replacement is undone', () => {
    stroke(5, 4);
    const grid = { ...useEditorStore.getState().map!.grid, squaresX: 3 };
    const resized = HeightField.empty(grid, 4);
    useEditorStore.getState().replaceTerrain('Resize', resized, (d) => void (d.grid.squaresX = 3));
    expect(useEditorStore.getState().terrain!.cols).toBe(13);

    useEditorStore.getState().undo();
    const terrain = useEditorStore.getState().terrain!;
    expect(terrain.cols).toBe(9);
    expect(terrain.data[5]).toBe(4);
    expect(useEditorStore.getState().map!.grid.squaresX).toBe(2);
  });

  it('clears the redo branch after a new edit', () => {
    useEditorStore.getState().edit('Rename', (d) => void (d.name = 'a'));
    useEditorStore.getState().undo();
    useEditorStore.getState().edit('Rename', (d) => void (d.name = 'b'));
    expect(useEditorStore.getState().canRedo).toBe(false);
  });

  it('saves the live terrain, not the heights stored at open time', () => {
    stroke(2, 6);
    const saved = HeightField.fromMap(useEditorStore.getState().snapshot());
    expect(saved.data[2]).toBe(6);
  });
});

describe('step hints', () => {
  it('shows a step hint until the step is left, also when a tool shortcut leaves it', () => {
    useEditorStore.setState({
      step: 'ground',
      helpSeen: { ground: false, walls: false, areas: false, objects: false },
    });
    useEditorStore.getState().setStep('ground');
    expect(useEditorStore.getState().helpSeen.ground).toBe(false);
    useEditorStore.getState().setTool('wall', 'walls');
    useEditorStore.getState().setStep('areas');
    expect(useEditorStore.getState().helpSeen).toEqual({ ground: true, walls: true, areas: false, objects: false });
  });
});
