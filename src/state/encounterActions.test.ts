import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createCreature, createEncounter, createMap, type Combatant, type Encounter } from '@/core/model';
import {
  addParty,
  applyDamage,
  applyHealing,
  createPc,
  describeAttack,
  currentCombatant,
  movedThisTurnFt,
  grantTempHp,
  nextTurn,
  orderByInitiative,
  previousTurn,
  removeCombatant,
  rollAttack,
  sessionOf,
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

  it('leaves the token to the creature, so later picture changes show', () => {
    const pictured = { ...goblin(), token: { area: 'data', path: 'library/creatures/goblin.token.png' } } as const;
    const spawned = spawnCombatant(pictured, goblinRef, { hpMode: 'average', side: 'enemy', takenNames: [] });
    expect(spawned.token).toBeNull();
  });

  it("adds the party members not in the encounter yet as player characters under their members' ids", () => {
    const character = (name: string) => ({
      ...createCreature(name),
      kind: 'player' as const,
      level: 3,
      hitPoints: { average: 24, formula: '' },
    });
    const brom = { member: { id: 'm1', creature: { area: 'data', id: 'brom' }, player: 'Anna' } as const };
    const ivy = { member: { id: 'm2', creature: { area: 'data', id: 'ivy' }, player: '' } as const };
    const party = [
      { ...brom, creature: character('Brom') },
      { ...ivy, creature: character('Ivy') },
    ];
    // A hand-entered Brom is no party member, so the party's Brom joins too.
    const encounter = encounterWith(['Brom']);
    expect(addParty(encounter, party.slice(0, 1))).toEqual([expect.stringMatching(/^Brom \d\d$/)]);
    expect(addParty(encounter, party)).toEqual(['Ivy']);
    expect(addParty(encounter, party)).toEqual([]);
    expect(encounter.combatants.slice(1)).toMatchObject([
      { id: 'm1', partyMemberId: 'm1', creature: brom.member.creature, side: 'player', visionSource: true, level: 3 },
      { id: 'm2', partyMemberId: 'm2', creature: ivy.member.creature, hp: { current: 24, max: 24, temp: 0 } },
    ]);
  });

  it('starts a party member as its session state left it, capped by a lower maximum', () => {
    const creature = { ...createCreature('Brom'), kind: 'player' as const, hitPoints: { average: 24, formula: '' } };
    const member = { id: 'm1', creature: { area: 'data', id: 'brom' }, player: '' } as const;
    const session = { hp: 30, tempHp: 5, slotsUsed: { '2': 1 }, deathSaves: { successes: 1, failures: 0 } };
    const encounter = encounterWith([]);
    addParty(encounter, [{ member, creature, session }]);
    expect(encounter.combatants[0]).toMatchObject({
      hp: { current: 24, max: 24, temp: 5 },
      resources: { slotsUsed: { '2': 1 } },
      deathSaves: { successes: 1, failures: 0 },
    });
    expect(sessionOf(encounter.combatants[0]!)).toEqual({ ...session, hp: 24 });
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
    expect(last.round).toBe(2);
  });

  it('starts a new round when the current combatant is removed at the end of the order', () => {
    const e = produce(encounterWith(['a', 'b', 'c']), (d) => {
      d.round = 1;
      d.turnIndex = 2;
      removeCombatant(d, d.combatants[2]!.id);
    });
    expect(currentCombatant(e)?.name).toBe('a');
    expect(e.round).toBe(2);
  });

  it('ends the turn of the last remaining combatant when it is removed', () => {
    const e = produce(encounterWith(['a']), (d) => {
      d.round = 3;
      removeCombatant(d, d.combatants[0]!.id);
    });
    expect([e.turnIndex, e.round]).toEqual([0, 3]);
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

  /** Rolls the given faces in order; each pair is `[face, sides]`. */
  const faces = (...rolls: [number, number][]) => {
    let i = 0;
    return () => {
      const [face, sides] = rolls[i++]!;
      return (face - 0.5) / sides;
    };
  };

  it('describes both d20s of an advantage roll and every damage die with its bonus', () => {
    const scimitar = { ...attack, toHit: 3, damage: [{ formula: '1d6+3', type: 'slashing' as const }] };
    const result = rollAttack('Goblin 1', 'Scimitar', scimitar, 'advantage', faces([6, 20], [14, 20], [2, 6]));
    expect(result.text).toBe('Goblin 1 · Scimitar: hit 17 = d20 14 (6) + 3 · dmg 5 slashing = 1d6 [2] + 3');
  });

  it('marks a critical hit, lists the crit dice and subtracts a negative modifier', () => {
    const club = { ...attack, toHit: -1, damage: [{ formula: '1d6-1', type: 'bludgeoning' as const }] };
    const result = rollAttack('Ogre', 'Club', club, 'normal', faces([20, 20], [4, 6], [5, 6]));
    expect(describeAttack('Club', result)).toBe(
      'Club: CRIT hit 19 = d20 20 - 1 · dmg 8 bludgeoning = 1d6 [4] + crit 1d6 [5] - 1',
    );
  });

  it('marks a natural 1 and keeps the lower die with disadvantage', () => {
    const bite = {
      ...attack,
      toHit: 2,
      damage: [
        { formula: '2d4', type: 'piercing' as const },
        { formula: '1d6', type: 'poison' as const },
      ],
    };
    const result = rollAttack('Wolf', 'Bite', bite, 'disadvantage', faces([1, 20], [15, 20], [1, 4], [3, 4], [6, 6]));
    expect(describeAttack('Bite', result)).toBe(
      'Bite: NAT 1 hit 3 = d20 1 (15) + 2 · dmg 4 piercing = 2d4 [1, 3] · 6 poison = 1d6 [6]',
    );
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
