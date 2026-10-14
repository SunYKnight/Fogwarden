import { damTerrainField, type DamProject } from '@/core/import/damProject';
import { withDamStructures } from '@/core/import/damStructures';
import type { ImportedContent, StructureSources } from '@/core/import/importedMap';
import { createMap, type BattleMap, type Grid, type MapImage, type Prop, type Vec2 } from '@/core/model';
import {
  fitSquaresToImage,
  reducedImageSize,
  scaleCalibration,
  type GridCalibration,
} from '@/core/terrain/calibration';
import type { Repository } from '@/data/repository';
import { MAX_TEXTURE_PX } from '@/render/loadImageTexture';

/** Battlemap exports commonly use 70 px per square when the file name gives no grid size. */
const DEFAULT_PX_PER_SQUARE = 70;
// Keeps grid lines and lettering of painted battlemaps free of artefacts.
const JPEG_QUALITY = 0.9;

export type ImageSize = Pick<MapImage, 'widthPx' | 'heightPx'>;

/** Grid size from names like "52x49_tavern.jpg" (squares wide x squares high). */
export function gridFromFileName(name: string): { squaresX: number; squaresY: number } | null {
  const match = /(\d{1,3})\s*x\s*(\d{1,3})/i.exec(name);
  return match ? { squaresX: Number(match[1]), squaresY: Number(match[2]) } : null;
}

// Dungeon Alchemist appends " UniversalVTT" or " AboveVTT" to UVTT names.
const FORMAT_SUFFIX = /\s+(UniversalVTT|AboveVTT)$/i;

export function mapNameFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim()
    .replace(FORMAT_SUFFIX, '');
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

export interface ImportedMapOptions {
  name: string;
  image: ImageSize;
  calibration: GridCalibration;
  /** Walls, doors, lights and ambient light from a map maker export. */
  content?: ImportedContent;
  /** The export's lines and doors as drawn; a project's buildings replace the ones they match. */
  sources?: StructureSources;
  /** Dungeon Alchemist project: ground heights become the terrain, its buildings walls and rooms. */
  project?: DamProject | null;
  /** Stores the battlemap picture in the new map's asset folder; the size is the stored picture's. */
  writeImage: (mapId: string) => Promise<MapImage>;
  /** Props placed on the new map; their models go to its asset folder. */
  props?: (mapId: string, grid: Grid) => Promise<Prop[]>;
}

/**
 * Saves a new map for an image with the grid already placed, so it opens calibrated. A picture
 * stored smaller than `image` gets the grid scaled along; the squares stay those of `image`.
 */
export async function saveImportedMap(repository: Repository, options: ImportedMapOptions): Promise<BattleMap> {
  const { name, image, calibration, content, sources, project } = options;
  const squares = fitSquaresToImage(image, calibration.pxPerSquare);
  const id = await repository.newLibraryId('map', name);
  const map = { ...createMap({ name, image: null, ...squares, pxPerSquare: calibration.pxPerSquare }), id };
  // Terrain and buildings first: a misfit project must fail before files are written.
  const heights = project ? damTerrainField(project, map.grid, map.terrain.samplesPerSquare).encode() : null;
  const structures = content && sources && project ? withDamStructures(content, sources, project, map.grid) : content;
  const stored = await options.writeImage(map.id);
  const scale = Math.max(stored.widthPx, stored.heightPx) / Math.max(image.widthPx, image.heightPx);
  const grid = { ...map.grid, ...scaleCalibration(calibration, scale) };
  const props = options.props ? await options.props(map.id, grid) : [];
  return repository.save('map', {
    ...map,
    ...structures,
    image: stored,
    grid,
    terrain: heights === null ? map.terrain : { ...map.terrain, heights },
    props,
  });
}

/** True when any pixel of the RGBA data is not fully opaque. */
export function hasTransparency(rgba: Uint8ClampedArray): boolean {
  let found = false;
  for (let i = 3; i < rgba.length && !found; i += 4) {
    found = rgba[i]! < 255;
  }
  return found;
}

/** The picture scaled to `size`: PNG where it is transparent, else the much smaller JPEG. */
async function encodeReduced(source: Blob, size: ImageSize): Promise<{ bytes: Uint8Array; extension: string }> {
  const { widthPx, heightPx } = size;
  // The canvas first: a bitmap open while it fails would never be closed.
  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('This system cannot draw images off screen to reduce the battlemap');
  }
  const bitmap = await createImageBitmap(source, {
    resizeWidth: widthPx,
    resizeHeight: heightPx,
    resizeQuality: 'high',
  });
  try {
    context.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
  const transparent = hasTransparency(context.getImageData(0, 0, widthPx, heightPx).data);
  const blob = await canvas.convertToBlob(
    transparent ? { type: 'image/png' } : { type: 'image/jpeg', quality: JPEG_QUALITY },
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: transparent ? 'png' : 'jpg' };
}

/**
 * Stores the battlemap picture `source` of size `image` for a new map. Pictures larger than the 3D
 * view ever shows are stored reduced, so players download and decode only what they can see.
 */
export async function storeMapImage(
  repository: Repository,
  mapId: string,
  fileName: string,
  source: Blob,
  image: ImageSize,
): Promise<MapImage> {
  const reduced = reducedImageSize(image, MAX_TEXTURE_PX);
  let stored: MapImage;
  if (reduced) {
    const { bytes, extension } = await encodeReduced(source, reduced);
    const asset = await repository.importMapAsset(mapId, `${fileName.replace(/\.[^.]*$/, '')}.${extension}`, bytes);
    stored = { asset, ...reduced };
  } else {
    const asset = await repository.importMapAsset(mapId, fileName, new Uint8Array(await source.arrayBuffer()));
    stored = { asset, ...image };
  }
  return stored;
}

/** Saves a new map for the image file with the grid already placed. */
export function createCalibratedMap(
  repository: Repository,
  file: File,
  options: Omit<ImportedMapOptions, 'writeImage'>,
): Promise<BattleMap> {
  return saveImportedMap(repository, {
    ...options,
    writeImage: (mapId) => storeMapImage(repository, mapId, file.name, file, options.image),
  });
}
