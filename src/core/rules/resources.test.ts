import { describe, expect, it } from 'vitest';
import { createCreature } from '../model';
import { creatureResources } from './resources';

const action = (name: string, description = '') => ({ name, description, attack: null });

describe('creature resources from the stat block', () => {
  it('reads legendary actions, recharge abilities and per-day traits of a dragon', () => {
    const dragon = createCreature('Adult Red Dragon');
    dragon.traits = [{ name: 'Legendary Resistance (3/Day)', description: 'If the dragon fails a saving throw…' }];
    dragon.actions = [action('Bite'), action('Fire Breath (Recharge 5-6)'), action('Frightful Presence')];
    dragon.legendaryDescription = 'The adult red dragon can take 3 legendary actions, choosing from the options.';
    dragon.legendaryActions = [{ name: 'Detect', description: '', cost: 1 }];
    expect(creatureResources(dragon)).toEqual({
      legendary: 3,
      recharge: [{ name: 'Fire Breath', min: 5 }],
      slots: {},
      daily: [{ name: 'Legendary Resistance', max: 3 }],
      lair: true,
    });
  });

  it('keeps rest-only recharges without a die', () => {
    const knight = createCreature('Knight');
    knight.actions = [action('Leadership (Recharges after a Short or Long Rest)'), action('Spear (Recharge 6)')];
    expect(creatureResources(knight).recharge).toEqual([
      { name: 'Leadership', min: null },
      { name: 'Spear', min: 6 },
    ]);
    expect(creatureResources(knight).lair).toBe(false);
  });

  it('reads spell slots by level', () => {
    const mage = createCreature('Mage');
    mage.traits = [
      {
        name: 'Spellcasting',
        description:
          'The mage is a 9th-level spellcaster. It has the following wizard spells prepared:\n' +
          'Cantrips (at will): fire bolt, light\n1st level (4 slots): detect magic, shield\n' +
          '3rd level (3 slots): counterspell, fireball\n5th level (1 slot): cone of cold',
      },
    ];
    expect(creatureResources(mage).slots).toEqual({ '1': 4, '3': 3, '5': 1 });
    expect(creatureResources(mage).daily).toEqual([]);
  });

  it('gives innate spells their own uses with "each" and a shared pool without', () => {
    const djinni = createCreature('Djinni');
    djinni.traits = [
      {
        name: 'Innate Spellcasting',
        description:
          "The djinni's innate spellcasting ability is Charisma (spell save DC 17). It can cast:\n" +
          'At will: detect magic, thunderwave\n' +
          '3/day each: create food and water (can create wine instead of water), tongues\n' +
          '1/day: conjure elemental (air elemental only), creation',
      },
    ];
    expect(creatureResources(djinni).daily).toEqual([
      { name: 'create food and water', max: 3 },
      { name: 'tongues', max: 3 },
      { name: 'conjure elemental, creation', max: 1 },
    ]);
  });

  it('marks stat blocks that mention lair actions', () => {
    const naga = createCreature('Naga');
    naga.traits = [{ name: 'Lair', description: 'On initiative count 20 the naga takes a lair action.' }];
    expect(creatureResources(naga).lair).toBe(true);
    expect(creatureResources(createCreature('Goblin'))).toEqual({
      legendary: 0,
      recharge: [],
      slots: {},
      daily: [],
      lair: false,
    });
  });
});
