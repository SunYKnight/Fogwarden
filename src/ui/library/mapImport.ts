import { createMap, type BattleMap, type MapImage, type Vec2 } from '@/core/model';
import { fitSquaresToImage, type GridCalibration } from '@/core/terrain/calibration';
import type { Repository } from '@/data/repository';

/** Battlemap exports commonly use 70 px per square when the file name gives no grid size. */
const DEFAULT_PX_PER_SQUARE = 70;

export type ImageSize = Pick<MapImage, 'widthPx' | 'heightPx'>;

/** Grid size from names like "52x49_tavern.jpg" (squares wide x squares high). */
export function gridFromFileName(name: string): { squaresX: number; squaresY: number } | null {
  const match = /(\d{1,3})\s*x\s*(\d{1,3})/i.exec(name);
  return match ? { squaresX: Number(match[1]), squaresY: Number(match[2]) } : null;
}

export function mapNameFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

/** Starting grid for the wizard: the file name's square count if present, else 70 px squares. */
export function guessCalibration(fileName: string, image: ImageSize): GridCalibration {
  const fromName = gridFromFileName(fileName);
  return {
    pxPerSquare: fromName ? image.widthPx / fromName.squaresX : DEFAULT_PX_PER_SQUARE,
    rotationDeg: 0,
    offsetPx: { x: 0, y: 0 },
  };
}

/** Hundredths keep slider readouts short; finer steps are invisible on any battlemap. */
export function roundCalibration(c: GridCalibration): GridCalibration {
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    pxPerSquare: round(c.pxPerSquare),
    rotationDeg: round(c.rotationDeg),
    offsetPx: { x: round(c.offsetPx.x), y: round(c.offsetPx.y) },
  };
}

export interface CornerGesture {
  /** First corner of a two-click calibration still waiting for the second click. */
  pending: Vec2 | null;
  /** Opposite corners of one grid square once the gesture is complete. */
  square: [Vec2, Vec2] | null;
}

/**
 * One pointer press on the image: a drag spans a square, a click sets the first corner or, with a
 * first corner pending, completes the square. `minPx` separates drags and distinct clicks from jitter.
 */
export function cornerGesture(pending: Vec2 | null, down: Vec2, up: Vec2, minPx: number): CornerGesture {
  const far = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) >= minPx;
  let result: CornerGesture = { pending: up, square: null };
  if (far(down, up)) {
    result = { pending: null, square: [down, up] };
  } else if (pending && far(pending, up)) {
    result = { pending: null, square: [pending, up] };
  }
  return result;
}

/** Saves a new map for the image with the grid already placed, so it opens calibrated. */
export async function createCalibratedMap(
  repository: Repository,
  file: File,
  options: { name: string; image: ImageSize; calibration: GridCalibration },
): Promise<BattleMap> {
  const { name, image, calibration } = options;
  const squares = fitSquaresToImage(image, calibration.pxPerSquare);
  const map = createMap({ name, image: null, ...squares, pxPerSquare: calibration.pxPerSquare });
  const asset = await repository.importMapAsset(map.id, file.name, new Uint8Array(await file.arrayBuffer()));
  return repository.save('map', {
    ...map,
    image: { asset, ...image },
    grid: { ...map.grid, ...calibration },
  });
}
