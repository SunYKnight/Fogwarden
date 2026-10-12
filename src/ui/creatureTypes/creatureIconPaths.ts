import { CREATURE_ICON_KEYS, type CreatureIconKey } from '@/core/creatureTypeIcon';

/** Edge length of the square view box all game-icons.net icons share. */
export const CREATURE_ICON_VIEW = 512;

const FILES = import.meta.glob<string>('./icons/*.svg', { query: '?raw', import: 'default', eager: true });

// Each file is a single filled path; the path data serves both inline SVG
// and the token canvas (Path2D) without an image decode.
function pathOf(key: CreatureIconKey): string {
  const d = /\sd="([^"]+)"/.exec(FILES[`./icons/${key}.svg`] ?? '')?.[1];
  if (!d) {
    throw new Error(`Creature type icon "${key}.svg" has no path`);
  }
  return d;
}

/** SVG path data of each creature type icon in a `CREATURE_ICON_VIEW` square. */
export const CREATURE_ICON_PATHS = Object.fromEntries(CREATURE_ICON_KEYS.map((k) => [k, pathOf(k)])) as Record<
  CreatureIconKey,
  string
>;
