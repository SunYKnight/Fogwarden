import { useEffect, useMemo } from 'react';
import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import { base64ToBytes } from '@/core/binary';
import { FOG_UNKNOWN, FOG_VISIBLE } from '@/core/vision/fog';
import { usePlayerStore } from '@/ui/player/playerStore';
import { useMapRender, type RenderMode } from '../mapRenderContext';
import { useFogViewStore } from './fogViewStore';

interface FogImage {
  width: number;
  height: number;
  cells: Uint8Array;
}

// Fog cells are texels; linear filtering softens the cell edges.
function fogTexture({ width, height, cells }: FogImage): DataTexture {
  const texture = new DataTexture(cells.slice(), width, height, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  // Rows of one byte per texel are not 4-byte aligned for most widths.
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function useFogImage(mode: RenderMode): FogImage {
  const received = usePlayerStore((s) => (mode === 'player' ? s.fog : null));
  const computed = useFogViewStore((s) => (mode === 'dm' ? s.fog : null));
  return useMemo(() => {
    const empty = { width: 1, height: 1, cells: new Uint8Array([mode === 'player' ? FOG_UNKNOWN : FOG_VISIBLE]) };
    const player = received && {
      width: received.cellsX,
      height: received.cellsY,
      cells: base64ToBytes(received.cells),
    };
    const dm = computed && { width: computed.size.cellsX, height: computed.size.cellsY, cells: computed.cells };
    return player ?? dm ?? empty;
  }, [mode, received, computed]);
}

function BrushOutline() {
  const { terrain } = useMapRender();
  const brush = useFogViewStore((s) => s.brush);
  const radius = useFogViewStore((s) => s.brushRadiusFt);
  const cursor = useFogViewStore((s) => s.cursor);
  return brush !== 'off' && cursor ? (
    <mesh
      position={[cursor.x, terrain.sample(cursor.x, cursor.y) + 0.3, cursor.y]}
      rotation-x={-Math.PI / 2}
      renderOrder={10}
    >
      <ringGeometry args={[Math.max(0, radius - 0.4), radius, 64]} />
      <meshBasicMaterial
        color={brush === 'reveal' ? '#9be37a' : brush === 'hide' ? '#e3577a' : '#e3d27a'}
        depthTest={false}
        transparent
      />
    </mesh>
  ) : null;
}

/**
 * Writes the fog into the shared `uFog` texture: received fog in the player view, the DM's computed
 * player fog in the DM view (the shader only tints it there). Without fog players see nothing and the
 * DM everything.
 */
export function FogLayer() {
  const { uniforms, mode } = useMapRender();
  const image = useFogImage(mode);

  useEffect(() => {
    const current = uniforms.uFog.value;
    const sameSize = current.image.width === image.width && current.image.height === image.height;
    if (mode !== 'editor' && sameSize) {
      (current.image.data as Uint8Array).set(image.cells);
      current.needsUpdate = true;
    } else if (mode !== 'editor') {
      uniforms.uFog.value = fogTexture(image);
      current.dispose();
    }
  }, [image, mode, uniforms]);

  return mode === 'dm' ? <BrushOutline /> : null;
}
