import { describe, expect, it } from 'vitest';
import type { Region } from '../model';
import { ambientGain, ambientListeners, ambientVoices, distanceToPolygon } from './ambient';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const sound = { asset: { area: 'data' as const, path: 'library/maps/m/assets/river.ogg' }, radiusFt: 20, volume: 0.8 };

describe('ambient regions', () => {
  it('measures the distance to the area, zero inside', () => {
    expect(distanceToPolygon({ x: 5, y: 5 }, square)).toBe(0);
    expect(distanceToPolygon({ x: 15, y: 5 }, square)).toBe(5);
    expect(distanceToPolygon({ x: 13, y: 14 }, square)).toBe(5);
  });

  it('plays at full volume inside and fades to silence at the radius', () => {
    expect(ambientGain(sound, square, [{ x: 5, y: 5 }])).toBe(0.8);
    expect(ambientGain(sound, square, [{ x: 20, y: 5 }])).toBeCloseTo(0.8 * 0.25);
    expect(ambientGain(sound, square, [{ x: 30, y: 5 }])).toBe(0);
    expect(ambientGain({ ...sound, radiusFt: 0 }, square, [{ x: 11, y: 5 }])).toBe(0);
  });

  it('follows the nearest listener and is silent without one', () => {
    expect(
      ambientGain(sound, square, [
        { x: 100, y: 0 },
        { x: 15, y: 5 },
      ]),
    ).toBeCloseTo(0.8 * 0.75 ** 2);
    expect(ambientGain(sound, square, [])).toBe(0);
  });

  it('hears through the viewing character or the whole party', () => {
    const combatants = [
      { id: 'pc1', side: 'player' as const, position: { x: 1, y: 2 } },
      { id: 'pc2', side: 'player' as const, position: null },
      { id: 'pc3', side: 'player' as const, position: { x: 3, y: 4 } },
      { id: 'gob', side: 'enemy' as const, position: { x: 5, y: 6 } },
    ];
    expect(ambientListeners(combatants, null)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(ambientListeners(combatants, 'pc3')).toEqual([{ x: 3, y: 4 }]);
  });

  it('plays only sound regions with a file', () => {
    const base: Region = {
      id: 'r1',
      name: 'River',
      polygon: square,
      kind: 'sound',
      light: null,
      color: '#000000',
      hiddenFromPlayers: false,
      notes: '',
      sound,
    };
    const regions: Region[] = [
      base,
      { ...base, id: 'r2', sound: { ...sound, asset: null } },
      { ...base, id: 'r3', kind: 'note', sound: null },
    ];
    expect(ambientVoices(regions, [{ x: 5, y: 5 }])).toEqual([{ id: 'r1', sound, gain: 0.8 }]);
  });
});
