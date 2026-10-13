import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, LinearFilter, PerspectiveCamera, SRGBColorSpace, Sprite, Vector3 } from 'three';

export interface LabelLine {
  text: string;
  color?: string;
  bold?: boolean;
}

interface TextLabelProps {
  position: [number, number, number];
  lines: LabelLine[];
  /** Health-style bar under the text: filled fraction 0..1 in `color`. */
  bar?: { fraction: number; color: string } | null;
  opacity?: number;
  /** Clicks on the label count as clicks on its parent (a token's name). */
  pickable?: boolean;
  /** Fill behind the text; dark by default. */
  background?: string;
}

const FONT_PX = 11;
const LINE_PX = 14;
const PAD_PX = 4;
const BAR_PX = 3;
// Drawn at 3x so the label stays sharp on high-DPI screens.
const SUPERSAMPLE = 3;
const NO_RAYCAST = () => undefined;
const LABEL_BACKGROUND = 'rgba(0, 0, 0, 0.65)';

interface LabelImage {
  texture: CanvasTexture;
  widthPx: number;
  heightPx: number;
}

function drawLabel(lines: LabelLine[], bar: TextLabelProps['bar'], background: string): LabelImage {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas is unavailable');
  }
  const font = (bold: boolean) => `${bold ? 600 : 400} ${FONT_PX}px 'Segoe UI', system-ui, sans-serif`;
  const textWidth = Math.max(
    ...lines.map((l) => {
      ctx.font = font(l.bold ?? false);
      return ctx.measureText(l.text).width;
    }),
  );
  const widthPx = Math.ceil(textWidth) + PAD_PX * 2;
  const heightPx = lines.length * LINE_PX + PAD_PX * 2 + (bar ? BAR_PX + 2 : 0);
  canvas.width = widthPx * SUPERSAMPLE;
  canvas.height = heightPx * SUPERSAMPLE;
  ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(0, 0, widthPx, heightPx, 3);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = font(line.bold ?? false);
    ctx.fillStyle = line.color ?? '#ffffff';
    ctx.fillText(line.text, widthPx / 2, PAD_PX + LINE_PX * (i + 0.5));
  });
  if (bar) {
    const y = PAD_PX + lines.length * LINE_PX + 1;
    ctx.fillStyle = '#333333';
    ctx.fillRect(PAD_PX, y, widthPx - PAD_PX * 2, BAR_PX);
    ctx.fillStyle = bar.color;
    ctx.fillRect(PAD_PX, y, (widthPx - PAD_PX * 2) * Math.max(0, Math.min(1, bar.fraction)), BAR_PX);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  return { texture, widthPx, heightPx };
}

const scratch = new Vector3();

/**
 * Screen-sized text drawn inside the scene; DOM overlays (drei Html) break when the canvas
 * unmounts under React 19, and in-scene labels also show up in the player view's rendering.
 */
export function TextLabel(props: TextLabelProps) {
  const { position, lines, bar = null, opacity = 1, pickable = false, background = LABEL_BACKGROUND } = props;
  const sprite = useRef<Sprite>(null);
  // Parsing the key back keeps the memo honest without a lint suppression.
  const key = JSON.stringify([lines, bar, background]);
  const image = useMemo(() => {
    const [l, b, fill] = JSON.parse(key) as [LabelLine[], TextLabelProps['bar'], string];
    return drawLabel(l, b, fill);
  }, [key]);
  useEffect(() => () => image.texture.dispose(), [image]);

  useFrame(({ camera, size }) => {
    const current = sprite.current;
    if (current) {
      const distance = camera.position.distanceTo(current.getWorldPosition(scratch));
      const perPixel =
        camera instanceof PerspectiveCamera
          ? (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / size.height
          : 1 / camera.zoom;
      current.scale.set(image.widthPx * perPixel, image.heightPx * perPixel, 1);
    }
  });

  return (
    <sprite
      ref={sprite}
      position={position}
      raycast={pickable ? Sprite.prototype.raycast : NO_RAYCAST}
      renderOrder={10}
    >
      <spriteMaterial map={image.texture} transparent opacity={opacity} depthTest={false} depthWrite={false} />
    </sprite>
  );
}
