/** Card height per card width: upright portraits keep their aspect between square and 2:3. */
const MIN_CARD_RATIO = 1;
const MAX_CARD_RATIO = 1.5;
/** Cards without a picture show initials on a moderately tall card. */
const PLAIN_CARD_RATIO = 1.4;
// Portraits put heads near the top; the crop keeps 90 % of the cut-off
// part below the window and only 10 % above it.
const TOP_BIAS = 0.9;

/** Card height divided by card width for an image of `imageAspect` (width / height); null without image. */
export function cardHeightRatio(imageAspect: number | null): number {
  return imageAspect === null ? PLAIN_CARD_RATIO : Math.min(MAX_CARD_RATIO, Math.max(MIN_CARD_RATIO, 1 / imageAspect));
}

/** Texture repeat/offset (UV units) of the part of an image a frame shows. */
export interface UvWindow {
  repeatX: number;
  repeatY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Part of an image (bottom row at v = 0) that fills a frame of `frameAspect` (width / height) without
 * distortion: too wide images lose both sides equally, too tall ones mostly their lower part.
 */
export function coverWindow(imageAspect: number, frameAspect: number): UvWindow {
  const repeatX = Math.min(1, frameAspect / imageAspect);
  const repeatY = Math.min(1, imageAspect / frameAspect);
  return { repeatX, repeatY, offsetX: (1 - repeatX) / 2, offsetY: (1 - repeatY) * TOP_BIAS };
}

/** Number that tells equal creatures apart ("Goblin 3" → "3"); empty when the name has none. */
export function tokenNumber(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .findLast((w) => /^\d+$/.test(w)) ?? ''
  );
}

/** Short text for a card without picture: initials of up to two words plus the number ("Goblin 3" → "G3"). */
export function tokenInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  const letters = words.filter((w) => !/^\d+$/.test(w)).flatMap((w) => w.match(/[\p{L}\p{N}]/u) ?? []);
  const text = letters.slice(0, 2).join('').toUpperCase() + tokenNumber(name);
  return text === '' ? '?' : text;
}
