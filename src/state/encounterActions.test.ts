import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createCreature, createEncounter, createMap, type Combatant, type Encounter } from '@/core/model';
import {
  applyDamage,
  applyHealing,
  createPc,
  currentCombatant,
  movedThisTurnFt,
  grantTempHp,
  nextTurn,
  orderByInitiative,
  previousTurn,
  removeCombatant,
  rollAttack,
  sortByInitiative,
  spawnCombatant,
  uniqueName,
} from './encounterActions';

/** Deterministic rng (mulberry32) so rolled values are reproducible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const goblinRef = { area: 'content', id: 'goblin' } as const;

function goblin() {
  const creature = createCreature('Goblin');
  creature.hitPoints = { average: 7, formula: '2d6' };
  return creature;
}

function pc(name: string, initiative: number | null): Combatant {
  return { ...createPc({ name, armorClass: 15, maxHp: 20, senses: {}, visionSource: true }), initiative };
}

function encounterWith(names: string[]): Encounter {
  const encounter = createEncounter('Fight', 'campaign', null);
  encounter.combatants = names.map((n) => pc(n, null));
  return encounter;
}

describe('hit points', () => {
  it('takes damage from temporary hit points first', () => {
    expect(applyDamage({ current: 10, max: 12, temp: 5 }, 3)).toEqual({ current: 10, max: 12, temp: 2 });
    expect(applyDamage({ current: 10, max: 12, temp: 5 }, 8)).toEqual({ current: 7, max: 12, temp: 0 });
  });

  it('never drops below 0 hit points', () => {
    expect(applyDamage({ current: 4, max: 12, temp: 0 }, 30).current).toBe(0);
  });

  it('caps healing at the maximum', () => {
    expect(applyHealing({ current: 9, max: 12, temp: 0 }, 10).current).toBe(12);
    expect(applyHealing({ current: 0, max: 12, temp: 0 }, 5).current).toBe(5);
  });

  it('keeps the higher temporary hit points instead of stacking', () => {
    expect(grantTempHp({ current: 5, max: 5, temp: 6 }, 4).temp).toBe(6);
    expect(grantTempHp({ current: 5, max: 5, temp: 2 }, 4).temp).toBe(4);
  });
});

describe('spawning', () => {
  it('numbers monsters with a random free two-digit number', () => {
    const rng = seeded(3);
    expect(uniqueName('Goblin', [], true, rng)).toMatch(/^Goblin \d\d$/);
    expect(uniqueName('Mira', [], false, rng)).toBe('Mira');
    expect(uniqueName('Mira', ['Mira'], false, rng)).toMatch(/^Mira \d\d$/);
    const allButOne = Array.from({ length: 100 }, (_, n) => `Goblin ${String(n).padStart(2, '0')}`).filter(
      (name) => name !== 'Goblin 42',
    );
    expect(uniqueName('Goblin', allButOne, true, rng)).toBe('Goblin 42');
    expect(uniqueName('Goblin', [...allButOne, 'Goblin 42', 'Goblin 100'], true, rng)).toBe('Goblin 101');
  });

  it('gives every spawned goblin a unique name', () => {
    const names: string[] = [];
    const rng = seeded(9);
    for (let i = 0; i < 30; i++) {
      names.push(
        spawnCombatant(goblin(), goblinRef, { hpMode: 'average', side: 'enemy', takenNames: names, rng }).name,
      );
    }
    expect(new Set(names).size).toBe(30);
    expect(names.every((n) => /^Goblin \d\d$/.test(n))).toBe(true);
  });

  it('uses the average or rolls within the formula bounds', () => {
    const average = spawnCombatant(goblin(), goblinRef, { hpMode: 'average', side: 'enemy', takenNames: [] });
    expect(average.hp).toEqual({ current: 7, max: 7, temp: 0 });
    const rng = seeded(42);
    const rolled = Array.from(
      { length: 200 },
      () => spawnCombatant(goblin(), goblinRef, { hpMode: 'rolled', side: 'enemy', takenNames: [], rng }).hp.max,
    );
    expect(Math.min(...rolled)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...rolled)).toBeLessThanOrEqual(12);
    expect(new Set(rolled).size).toBeGreaterThan(5);
  });

  it('never rolls fewer than 1 hit point', () => {
    const weak = { ...goblin(), hitPoints: { average: 1, formula: '1d4-5' } };
    const rng = seeded(7);
    const hp = spawnCombatant(weak, goblinRef, { hpMode: 'rolled', side: 'enemy', takenNames: [], rng }).hp.max;
    expect(hp).toBe(1);
  });
});

describe('initiative order', () => {
  it('sorts by initiative, ties by Dexterity, unrolled last, keeping order otherwise', () => {
    const dex: Record<string, number> = { a: 10, b: 16, c: 10, d: 10, e: 18 };
    const order = orderByInitiative([pc('a', 12), pc('b', 12), pc('c', 15), pc('d', 12), pc('e', null)], (c) =>
      Number(dex[c.name]),
    );
    expect(order.map((c) => c.name)).toEqual(['c', 'b', 'a', 'd', 'e']);
  });

  it('keeps the turn with the same combatant when sorting', () => {
    const encounter = encounterWith(['a', 'b', 'c']);
    encounter.combatants.forEach((c, i) => (c.initiative = [5, 10, 20][i]!));
    encounter.round = 1;
    encounter.turnIndex = 0;
    const sorted = produce(encounter, (d) => sortByInitiative(d, () => 10));
    expect(sorted.combatants.map((c) => c.name)).toEqual(['c', 'b', 'a']);
    expect(currentCombatant(sorted)?.name).toBe('a');
  });
});

describe('turns', () => {
  it('starts round 1, wraps into the next round and steps back across rounds', () => {
    let e = encounterWith(['a', 'b', 'c']);
    e = produce(e, nextTurn);
    expect([e.round, currentCombatant(e)?.name]).toEqual([1, 'a']);
    e = produce(e, (d) => {
      nextTurn(d);
      nextTurn(d);
      nextTurn(d);
    });
    expect([e.round, currentCombatant(e)?.name]).toEqual([2, 'a']);
    e = produce(e, previousTurn);
    expect([e.round, currentCombatant(e)?.name]).toEqual([1, 'c']);
  });

  it('does not step back before the first turn', () => {
    const e = produce(produce(encounterWith(['a', 'b']), nextTurn), previousTurn);
    expect([e.round, e.turnIndex]).toEqual([1, 0]);
  });

  it('does nothing without combatants', () => {
    const e = produce(encounterWith([]), nextTurn);
    expect(e.round).toBe(0);
  });

  it('keeps the current combatant when an earlier one is removed', () => {
    const e = produce(encounterWith(['a', 'b', 'c']), (d) => {
      d.round = 1;
      d.turnIndex = 2;
      removeCombatant(d, d.combatants[0]!.id);
    });
    expect(currentCombatant(e)?.name).toBe('c');
  });

  it('passes the turn on when the current combatant is removed', () => {
    const e = produce(encounterWith(['a', 'b', 'c']), (d) => {
      d.round = 1;
      d.turnIndex = 1;
      removeCombatant(d, d.combatants[1]!.id);
    });
    expect(currentCombatant(e)?.name).toBe('c');
    const last = produce(e, (d) => removeCombatant(d, d.combatants[1]!.id));
    expect(currentCombatant(last)?.name).toBe('a');
  });
});

describe('attacks', () => {
  const attack = {
    kind: 'melee-weapon',
    toHit: 4,
    reachFt: 5,
    rangeFt: null,
    targets: 'one target',
    damage: [{ formula: '1d6+2', type: 'slashing' }],
  } as const;

  it('doubles the damage dice but not the bonus on a natural 20', () => {
    const result = rollAttack('Goblin 1', 'Scimitar', { ...attack, damage: [...attack.damage] }, 'normal', () => 0.999);
    expect(result.critical).toBe(true);
    expect(result.toHit.total).toBe(24);
    expect(result.damage[0]!.total).toBe(14);
    expect(result.text).toContain('Goblin 1 · Scimitar');
  });

  it('rolls damage once on a normal hit', () => {
    const result = rollAttack('Goblin 1', 'Scimitar', { ...attack, damage: [...attack.damage] }, 'normal', () => 0);
    expect(result.critical).toBe(false);
    expect(result.toHit.total).toBe(5);
    expect(result.damage[0]!.total).toBe(3);
  });
});

describe('distance moved this turn', () => {
  const grid = createMap({ name: 'm', image: null, squaresX: 20, squaresY: 20, pxPerSquare: 100 }).grid;
  const at = (sx: number, sy: number) => ({ x: sx * 5 + 2.5, y: sy * 5 + 2.5, elevationFt: 0 });

  it('counts from where the turn began, by the diagonal rule, and restarts with the next turn', () => {
    const encounter = produce(encounterWith(['a', 'b']), (d) => {
      d.combatants[0]!.position = at(0, 0);
      d.combatants[1]!.position = at(5, 5);
      nextTurn(d);
      // Three diagonal squares: 15 ft by the PHB, 20 ft with every second diagonal at 10 ft.
      d.combatants[0]!.position = at(3, 3);
    });
    expect(movedThisTurnFt(encounter, grid, '5-5-5')).toBe(15);
    expect(movedThisTurnFt(encounter, grid, '5-10-5')).toBe(20);
    const next = produce(encounter, (d) => void nextTurn(d));
    expect(movedThisTurnFt(next, grid, '5-5-5')).toBe(0);
    const back = produce(next, (d) => void previousTurn(d));
    expect(movedThisTurnFt(back, grid, '5-5-5')).toBe(0);
  });

  it('is unknown before combat and for a combatant off the map', () => {
    const encounter = encounterWith(['a']);
    expect(movedThisTurnFt(encounter, grid, '5-5-5')).toBeNull();
    const started = produce(encounter, (d) => void nextTurn(d));
    expect(movedThisTurnFt(started, grid, '5-5-5')).toBeNull();
  });
});
