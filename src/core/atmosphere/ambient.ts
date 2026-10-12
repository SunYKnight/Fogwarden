import { closestPointOnSegment } from '../geometry/polygon';
import { pointInPolygon } from '../geometry/walls';
import type { Region, RegionSound, Side, Vec2 } from '../model';

/** Feet from `point` to the polygon's area; 0 inside. */
export function distanceToPolygon(point: Vec2, polygon: Vec2[]): number {
  const edges = polygon.map((a, i) => closestPointOnSegment(point, a, polygon[(i + 1) % polygon.length]!).distance);
  return pointInPolygon(point, polygon) ? 0 : Math.min(...edges);
}

/**
 * Volume 0..1 of an ambient loop for listeners at `listeners`: the region's volume inside, fading with the
 * square of the remaining distance to silence `radiusFt` beyond the edge, judged by the nearest listener.
 */
export function ambientGain(sound: RegionSound, polygon: Vec2[], listeners: readonly Vec2[]): number {
  const distance = Math.min(Infinity, ...listeners.map((p) => distanceToPolygon(p, polygon)));
  const inside = distance === 0;
  const fade = sound.radiusFt > 0 ? Math.max(0, 1 - distance / sound.radiusFt) ** 2 : 0;
  return sound.volume * (inside ? 1 : fade);
}

export interface Listener {
  id: string;
  side: Side;
  position: Vec2 | null;
}

/**
 * Who hears the ambience of a view: the viewing character in its own view, every placed player character
 * in the party view (`viewerId` null).
 */
export function ambientListeners(combatants: readonly Listener[], viewerId: string | null): Vec2[] {
  return combatants
    .filter((c) => (viewerId === null ? c.side === 'player' : c.id === viewerId))
    .flatMap((c) => (c.position ? [{ x: c.position.x, y: c.position.y }] : []));
}

/** One playing loop per sound region with a file, at its current gain. */
export interface AmbientVoice {
  id: string;
  sound: RegionSound & { asset: NonNullable<RegionSound['asset']> };
  gain: number;
}

export function ambientVoices(regions: readonly Region[], listeners: readonly Vec2[]): AmbientVoice[] {
  return regions.flatMap((region) => {
    const sound = region.kind === 'sound' ? region.sound : null;
    return sound?.asset
      ? [
          {
            id: region.id,
            sound: { ...sound, asset: sound.asset },
            gain: ambientGain(sound, region.polygon, listeners),
          },
        ]
      : [];
  });
}
