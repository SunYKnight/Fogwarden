import { describe, expect, it } from 'vitest';
import { createCreature, createEncounter, type Combatant, type Creature, type Encounter } from '@/core/model';
import {
  addEffect,
  advanceTurn,
  applyAreaDamage,
  combatXp,
  concentrationDc,
  describeXp,
  effectExpiry,
  rollAreaSaves,
  rollDeathSave,
  settleHpChange,
  stabilize,
} from './combatRules';
import { createPc } from './encounterActions';

/** Rng whose d20 rolls come out as `naturals` (d6 rolls scale the same way). */
function dice(...values: number[]): () => number {
  let i = 0;
  return () => (values[i++ % values.length]! - 0.5) / 20;
}

function combatant(name: string, initiative: number | null = null, side: Combatant['side'] = 'player'): Combatant {
  return { ...createPc({ name, armorClass: 12, maxHp: 20, senses: {}, visionSource: true }), initiative, side };
}

function fight(...names: string[]): Encounter {
  const encounter = createEncounter('Fight', 'c1', null);
  encounter.combatants = names.map((n) => combatant(n));
  return encounter;
}

const byName = (e: Encounter, name: string) => e.combatants.find((c) => c.name === name)!;
const noCreature = () => null;
const texts = (e: Encounter) => e.log.map((l) => l.text);

describe('effect durations', () => {
  it('ends a one-round effect when the turn it was applied in comes round again', () => {
    const e = fight('Ann', 'Bo', 'Cy');
    advanceTurn(e, noCreature);
    const bo = byName(e, 'Bo');
    addEffect(e, bo, 'Hold Person', 'paralyzed', effectExpiry(e, bo.id, { kind: 'rounds', rounds: 1 }));
    expect(bo.conditions).toEqual(['paralyzed']);
    advanceTurn(e, noCreature);
    advanceTurn(e, noCreature);
    expect(bo.effects).toHaveLength(1);
    advanceTurn(e, noCreature);
    expect(e.round).toBe(2);
    expect(bo.effects).toEqual([]);
    expect(bo.conditions).toEqual([]);
    expect(texts(e)).toContain('Hold Person on Bo ended');
  });

  it('ends "until the end of X\'s next turn" this round while X has yet to act, else next round', () => {
    const e = fight('Ann', 'Bo', 'Cy');
    advanceTurn(e, noCreature);
    const cy = byName(e, 'Cy');
    const bo = byName(e, 'Bo');
    const ann = byName(e, 'Ann');
    expect(effectExpiry(e, cy.id, { kind: 'turn', of: bo.id, at: 'end' })).toEqual({
      round: 1,
      turnOf: bo.id,
      at: 'end',
    });
    expect(effectExpiry(e, cy.id, { kind: 'turn', of: ann.id, at: 'start' })).toEqual({
      round: 2,
      turnOf: ann.id,
      at: 'start',
    });
    addEffect(e, cy, 'Dodge', null, effectExpiry(e, cy.id, { kind: 'turn', of: bo.id, at: 'end' }));
    advanceTurn(e, noCreature);
    expect(cy.effects).toHaveLength(1);
    advanceTurn(e, noCreature);
    expect(cy.effects).toEqual([]);
  });

  it('keeps a condition another effect still imposes', () => {
    const e = fight('Ann', 'Bo');
    advanceTurn(e, noCreature);
    const bo = byName(e, 'Bo');
    addEffect(e, bo, 'Web', 'restrained', effectExpiry(e, bo.id, { kind: 'rounds', rounds: 1 }));
    addEffect(e, bo, 'Net', 'restrained', null);
    advanceTurn(e, noCreature);
    advanceTurn(e, noCreature);
    expect(bo.effects.map((x) => x.name)).toEqual(['Net']);
    expect(bo.conditions).toEqual(['restrained']);
  });

  it('ends an effect tied to a removed combatant once its round is over', () => {
    const e = fight('Ann', 'Bo', 'Cy');
    advanceTurn(e, noCreature);
    const cy = byName(e, 'Cy');
    addEffect(e, byName(e, 'Ann'), 'Bane', null, effectExpiry(e, cy.id, { kind: 'turn', of: cy.id, at: 'end' }));
    e.combatants = e.combatants.filter((c) => c.id !== cy.id);
    advanceTurn(e, noCreature);
    expect(byName(e, 'Ann').effects).toHaveLength(1);
    advanceTurn(e, noCreature);
    expect(byName(e, 'Ann').effects).toEqual([]);
  });
});

describe('concentration', () => {
  it('asks for DC 10 or half the damage', () => {
    expect(concentrationDc(5)).toBe(10);
    expect(concentrationDc(21)).toBe(10);
    expect(concentrationDc(22)).toBe(11);
    expect(concentrationDc(45)).toBe(22);
  });

  it('owes a save after damage and ends at 0 hit points', () => {
    const e = fight('Ann');
    const ann = byName(e, 'Ann');
    ann.concentrating = true;
    ann.hp.current = 8;
    expect(settleHpChange(e, ann, 20, 12)).toBe(10);
    expect(settleHpChange(e, ann, 8, 0)).toBeNull();
    ann.hp.current = 0;
    expect(settleHpChange(e, ann, 8, 30)).toBeNull();
    expect(ann.concentrating).toBe(false);
    expect(texts(e)).toContain('Ann loses concentration (0 HP)');
  });
});

describe('monster resources at the start of a turn', () => {
  function dragon(): Creature {
    const creature = createCreature('Dragon');
    creature.actions = [{ name: 'Fire Breath (Recharge 5-6)', description: '', attack: null }];
    creature.legendaryDescription = 'The dragon can take 3 legendary actions.';
    creature.legendaryActions = [{ name: 'Tail', description: '', cost: 1 }];
    return creature;
  }

  it('resets legendary actions at its own turn and rolls the recharge die', () => {
    const e = fight('Ann', 'Dragon');
    const red = byName(e, 'Dragon');
    const creatureOf = (c: Combatant) => (c.id === red.id ? dragon() : null);
    red.resources.legendaryUsed = 2;
    red.resources.recharging = ['Fire Breath'];
    advanceTurn(e, creatureOf, dice(4));
    expect(red.resources.legendaryUsed).toBe(2);
    advanceTurn(e, creatureOf, dice(4));
    expect(red.resources.legendaryUsed).toBe(0);
    expect(red.resources.recharging).toEqual(['Fire Breath']);
    expect(texts(e)).toContain('Dragon · Fire Breath recharge: 2, still spent (needs 5)');
    advanceTurn(e, creatureOf, dice(20));
    advanceTurn(e, creatureOf, dice(20));
    expect(red.resources.recharging).toEqual([]);
    expect(texts(e)).toContain('Dragon · Fire Breath recharge: 6, recharged');
  });

  it('reminds of lair actions when initiative 20 passes', () => {
    const e = createEncounter('Lair', 'c1', null);
    e.combatants = [combatant('Fast', 22), combatant('Dragon', 15, 'enemy'), combatant('Slow', 10)];
    const red = byName(e, 'Dragon');
    const creatureOf = (c: Combatant) => (c.id === red.id ? dragon() : null);
    expect(advanceTurn(e, creatureOf)).toEqual([]);
    expect(advanceTurn(e, creatureOf)).toEqual(['Dragon']);
    expect(advanceTurn(e, creatureOf)).toEqual([]);
    expect(advanceTurn(e, creatureOf)).toEqual([]);
    expect(texts(e)).toContain('Lair action (initiative 20): Dragon');
    e.combatants.forEach((c) => (c.initiative = 25));
    expect(advanceTurn(e, creatureOf)).toEqual([]);
    expect(advanceTurn(e, creatureOf)).toEqual([]);
    expect(advanceTurn(e, creatureOf)).toEqual(['Dragon']);
  });
});

describe('death saves', () => {
  function dying() {
    const e = fight('Ann');
    const ann = byName(e, 'Ann');
    ann.hp.current = 0;
    return { e, ann };
  }

  it('counts 10 or higher as a success and three successes as stable', () => {
    const { e, ann } = dying();
    rollDeathSave(e, ann, dice(10));
    rollDeathSave(e, ann, dice(15));
    rollDeathSave(e, ann, dice(19));
    expect(ann.deathSaves).toEqual({ successes: 3, failures: 0 });
    expect(texts(e).at(-1)).toBe('Ann death save: 19, success (3/3), stable');
  });

  it('counts a natural 1 as two failures and logs the death on the third', () => {
    const { e, ann } = dying();
    rollDeathSave(e, ann, dice(1));
    expect(ann.deathSaves).toEqual({ successes: 0, failures: 2 });
    rollDeathSave(e, ann, dice(9));
    expect(ann.deathSaves.failures).toBe(3);
    expect(e.log.at(-1)).toMatchObject({ kind: 'death', text: 'Ann dies (3 failed death saves)' });
  });

  it('brings the character back with 1 HP on a natural 20', () => {
    const { e, ann } = dying();
    rollDeathSave(e, ann, dice(5));
    rollDeathSave(e, ann, dice(20));
    expect(ann.hp.current).toBe(1);
    expect(ann.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  it('fails a save on damage at 0 HP, ends stability, and starts fresh after healing', () => {
    const { e, ann } = dying();
    stabilize(e, ann);
    settleHpChange(e, ann, 0, 4);
    expect(ann.deathSaves).toEqual({ successes: 0, failures: 1 });
    ann.hp.current = 5;
    settleHpChange(e, ann, 0, 0);
    expect(ann.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});

describe('area saves and damage', () => {
  it('rolls each save with its bonus and applies one damage roll with resistances', () => {
    const e = fight('Ann', 'Troll', 'Bo');
    const [ann, troll, bo] = e.combatants as [Combatant, Combatant, Combatant];
    troll.hp = { current: 30, max: 30, temp: 0 };
    bo.concentrating = true;
    const saved = rollAreaSaves(
      e,
      'Fireball',
      { ability: 'dex', dc: 15 },
      [
        { id: ann.id, bonus: 2 },
        { id: troll.id, bonus: 5 },
        { id: bo.id, bonus: 0 },
      ],
      dice(12, 10, 14),
    );
    expect(saved).toEqual({ [ann.id]: false, [troll.id]: true, [bo.id]: false });
    const owed = applyAreaDamage(e, 'Fireball', 28, 'fire', true, [
      { id: ann.id, saved: false, response: 'normal' },
      { id: troll.id, saved: true, response: 'resistant' },
      { id: bo.id, saved: false, response: 'immune' },
    ]);
    expect([ann.hp.current, troll.hp.current, bo.hp.current]).toEqual([0, 23, 20]);
    expect(owed).toEqual({});
    expect(texts(e)).toContain('Fireball: Troll takes 7 fire (saved, resistant): 30 → 23 HP');
    expect(ann.deathSaves.failures).toBe(0);
  });

  it('owes concentration saves for damage taken', () => {
    const e = fight('Bo');
    const bo = byName(e, 'Bo');
    bo.hp = { current: 60, max: 60, temp: 0 };
    bo.concentrating = true;
    expect(
      applyAreaDamage(e, 'Cone of Cold', 36, 'cold', true, [{ id: bo.id, saved: false, response: 'normal' }]),
    ).toEqual({ [bo.id]: 18 });
  });
});

describe('experience', () => {
  it('splits the XP of defeated enemies among the player characters', () => {
    const e = fight('Ann', 'Bo', 'Cy');
    const goblins = ['Goblin 1', 'Goblin 2', 'Goblin 3'].map((n) => combatant(n, null, 'enemy'));
    goblins[0]!.hp.current = 0;
    goblins[1]!.hp.current = 0;
    e.combatants.push(...goblins);
    const award = combatXp(e, (c) => (c.side === 'enemy' ? 50 : 0));
    expect(award).toEqual({
      total: 100,
      defeated: ['Goblin 1', 'Goblin 2'],
      characters: ['Ann', 'Bo', 'Cy'],
      share: 33,
    });
    expect(describeXp(award)).toBe('XP: 100 from 2 defeated enemies, 33 each for Ann, Bo, Cy');
  });
});
