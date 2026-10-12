import { describe, expect, it } from 'vitest';
import { createCreature, createMap, type AreaDimensions, type CreatureSize, type MapPoint } from '../model';
import { areaDamage, combatantsInArea, damageResponse, saveBonus } from './areaEffects';

const grid = createMap({ name: 'g', image: null, squaresX: 30, squaresY: 30, pxPerSquare: 50 }).grid;

function token(id: string, x: number, y: number, size: CreatureSize = 'medium') {
  const position: MapPoint | null = { x, y, elevationFt: 0 };
  return { id, size, position };
}

function area(dimensions: Partial<AreaDimensions>, origin: MapPoint, directionDeg = 0) {
  return { shape: 'sphere' as const, sizeFt: 20, widthFt: 5, heightFt: 20, ...dimensions, origin, directionDeg };
}

const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('targets inside an area', () => {
  it('finds tokens with a footprint square inside a 20 ft sphere', () => {
    const fireball = area({}, { x: 50, y: 50, elevationFt: 0 });
    const tokens = [
      token('centre', 52.5, 52.5),
      token('edge', 67.5, 52.5),
      token('outside', 72.5, 52.5),
      token('large-touching', 70, 50, 'large'),
      token('large-outside', 75, 50, 'large'),
      { id: 'unplaced', size: 'medium' as const, position: null },
    ];
    expect(ids(combatantsInArea(fireball, grid, tokens))).toEqual(['centre', 'edge', 'large-touching']);
  });

  it('follows the direction of a line', () => {
    const bolt = area({ shape: 'line', sizeFt: 30, widthFt: 5 }, { x: 0, y: 12.5, elevationFt: 0 });
    const tokens = [token('end', 27.5, 12.5), token('beside', 27.5, 17.5), token('beyond', 32.5, 12.5)];
    expect(ids(combatantsInArea(bolt, grid, tokens))).toEqual(['end']);
    const south = area({ shape: 'line', sizeFt: 30, widthFt: 5 }, { x: 27.5, y: 0, elevationFt: 0 }, 90);
    expect(ids(combatantsInArea(south, grid, tokens))).toEqual(['end', 'beside']);
  });
});

describe('saves and damage', () => {
  const creature = createCreature('Ice troll');
  creature.abilities = { ...creature.abilities, dex: 8, con: 18 };
  creature.savingThrows = { con: 7 };
  creature.damageResistances = ['fire'];
  creature.damageImmunities = ['poison', 'bludgeoning, piercing, and slashing from nonmagical weapons'];
  creature.damageVulnerabilities = ['cold'];

  it('uses the proficient save, else the ability modifier, else nothing', () => {
    expect(saveBonus(creature, 'con')).toBe(7);
    expect(saveBonus(creature, 'dex')).toBe(-1);
    expect(saveBonus(null, 'dex')).toBe(0);
  });

  it('reads plain damage types and ignores qualified weapon entries', () => {
    expect(damageResponse(creature, 'fire')).toBe('resistant');
    expect(damageResponse(creature, 'poison')).toBe('immune');
    expect(damageResponse(creature, 'cold')).toBe('vulnerable');
    expect(damageResponse(creature, 'bludgeoning')).toBe('normal');
    expect(damageResponse(null, 'fire')).toBe('normal');
  });

  it('halves on a save first, then applies resistance or vulnerability, rounding down', () => {
    expect(areaDamage(27, false, true, 'normal')).toBe(27);
    expect(areaDamage(27, true, true, 'normal')).toBe(13);
    expect(areaDamage(27, true, false, 'normal')).toBe(0);
    expect(areaDamage(27, false, true, 'resistant')).toBe(13);
    expect(areaDamage(27, true, true, 'resistant')).toBe(6);
    expect(areaDamage(27, true, true, 'vulnerable')).toBe(26);
    expect(areaDamage(27, false, true, 'immune')).toBe(0);
  });
});
