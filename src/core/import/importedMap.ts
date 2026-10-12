import type { z } from 'zod';
import type { LightLevel } from '../model/common';
import type { BattleMap } from '../model/map';
import type { GridCalibration } from '../terrain/calibration';

/** What a map maker export adds to a new map besides the image and the grid. */
export type ImportedContent = Pick<BattleMap, 'walls' | 'openings' | 'lights' | 'ambientLight' | 'notes'>;

export interface ImportedMap {
  calibration: GridCalibration;
  content: ImportedContent;
}

export type ImageExtension = 'png' | 'jpg' | 'webp';

/** Picture type from the file signature; exports label JPEG data as PNG often enough to not trust names. */
export function sniffImage(bytes: Uint8Array): ImageExtension | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  let type: ImageExtension | null = null;
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') {
    type = 'png';
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    type = 'jpg';
  } else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    type = 'webp';
  }
  return type;
}

/**
 * `#rrggbb` from `rrggbb`, `#rrggbb` or eight digits. Eight digits are ARGB as Dungeondraft and
 * Dungeon Alchemist write them (opaque white is `ffffffff`).
 */
export function parseHexColor(text: string): string {
  const digits = text.replace(/^#/, '');
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(digits)) {
    throw new Error(`"${text}" is not a hex color`);
  }
  return `#${digits.slice(-6).toLowerCase()}`;
}

const LIGHTER: Record<LightLevel, LightLevel> = {
  bright: 'bright',
  dim: 'bright',
  darkness: 'dim',
  'magical-darkness': 'darkness',
};

/** Ambient light level of a scene tint by its perceived brightness. */
export function lightLevelOfColor(color: string): LightLevel {
  const value = parseInt(color.slice(1), 16);
  const luminance = (0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff)) / 255;
  return luminance >= 0.6 ? 'bright' : luminance >= 0.2 ? 'dim' : 'darkness';
}

/**
 * Ambient level and map note for an image with lighting painted in. The scene renders one level
 * lighter than the export says, because the picture already shows the darkness.
 */
export function bakedLighting(level: LightLevel): Pick<ImportedContent, 'ambientLight' | 'notes'> {
  const ambientLight = LIGHTER[level];
  const change =
    ambientLight === level ? '' : `; ambient light is ${ambientLight} instead of ${level} so it is not darkened twice`;
  return { ambientLight, notes: `Lighting is baked into the battlemap image${change}.` };
}

/** Parses `data` or throws an error naming the file and the first invalid field. */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, fileName: string, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const field = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new Error(`"${fileName}" is not a valid ${what} (${field}${issue.message})`);
  }
  return result.data;
}

/** JSON of a file, or an error naming the file. */
export function parseJsonFile(text: string, fileName: string): unknown {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`"${fileName}" is not JSON (${(error as Error).message})`, { cause: error });
  }
  return data;
}
