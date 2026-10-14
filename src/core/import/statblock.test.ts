import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { creatureSchema } from '../model';
import { parseStatBlock, StatBlockError } from './statblock';

/** SRD 5.1 creatures (CC-BY-4.0) written in the layout of the legacy raw stat block files. */
function fixture(name: string) {
  const creature = parseStatBlock(readFileSync(join(import.meta.dirname, 'fixtures', `${name}.txt`), 'utf8'));
  return creatureSchema.parse(creature);
}

describe('parseStatBlock on SRD fixtures', () => {
  it('reads the goblin header, skills as bonuses and both weapon attacks', () => {
    const goblin = fixture('goblin');
    expect(goblin).toMatchObject({
      name: 'Goblin',
      kind: 'monster',
      source: 'Monster Manual (SRD)',
      size: 'small',
      type: 'humanoid',
      subtype: 'Goblinoid',
      alignmentText: 'neutral evil',
      alignmentWeights: { 'neutral-evil': 1 },
      armorClass: 15,
      armorNote: 'leather armor, shield',
      hitPoints: { average: 7, formula: '2d6' },
      speeds: { walk: 30 },
      hover: false,
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      skills: { stealth: 6 },
      senses: { darkvision: 60 },
      passivePerception: 9,
      languages: ['Common', 'Goblin'],
      challenge: 0.25,
      xp: 50,
      traits: [{ name: 'Nimble Escape' }],
      notes: '',
    });
    expect(goblin.actions).toEqual([
      {
        name: 'Scimitar',
        description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.',
        attack: {
          kind: 'melee-weapon',
          toHit: 4,
          reachFt: 5,
          rangeFt: null,
          targets: 'one target',
          damage: [{ formula: '1d6+2', type: 'slashing' }],
        },
      },
      {
        name: 'Shortbow',
        description: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.',
        attack: {
          kind: 'ranged-weapon',
          toHit: 4,
          reachFt: null,
          rangeFt: { normal: 80, long: 320 },
          targets: 'one target',
          damage: [{ formula: '1d6+2', type: 'piercing' }],
        },
      },
    ]);
  });

  it('keeps every damage term of the adult red dragon bite and the legendary action costs', () => {
    const dragon = fixture('adult-red-dragon');
    expect(dragon).toMatchObject({
      size: 'huge',
      type: 'dragon',
      hitPoints: { average: 256, formula: '19d12+133' },
      speeds: { walk: 40, climb: 40, fly: 80 },
      savingThrows: { dex: 6, con: 13, wis: 7, cha: 11 },
      skills: { perception: 13, stealth: 6 },
      damageImmunities: ['fire'],
      senses: { blindsight: 60, darkvision: 120 },
      passivePerception: 23,
      challenge: 17,
      xp: 18000,
      traits: [{ name: 'Legendary Resistance (3/Day)' }],
    });
    expect(dragon.actions.map((a) => a.name)).toEqual([
      'Multiattack',
      'Bite',
      'Claw',
      'Tail',
      'Frightful Presence',
      'Fire Breath (Recharge 5-6)',
    ]);
    expect(dragon.actions[1]!.attack).toEqual({
      kind: 'melee-weapon',
      toHit: 14,
      reachFt: 10,
      rangeFt: null,
      targets: 'one target',
      damage: [
        { formula: '2d10+8', type: 'piercing' },
        { formula: '2d6', type: 'fire' },
      ],
    });
    expect(dragon.actions[5]!.attack).toBeNull();
    expect(dragon.legendaryDescription).toMatch(/^The dragon can take 3 legendary actions/);
    expect(dragon.legendaryActions.map((a) => [a.name, a.cost])).toEqual([
      ['Detect', 1],
      ['Tail Attack', 1],
      ['Wing Attack', 2],
    ]);
  });

  it('spreads "any evil alignment" and splits the lich spell list per level', () => {
    const lich = fixture('lich');
    expect(lich.alignmentWeights).toEqual({ 'lawful-evil': 1 / 3, 'neutral-evil': 1 / 3, 'chaotic-evil': 1 / 3 });
    expect(lich.damageResistances).toEqual(['cold', 'lightning', 'necrotic']);
    expect(lich.damageImmunities).toEqual(['poison', 'bludgeoning, piercing, and slashing from nonmagical weapons']);
    expect(lich.conditionImmunities).toEqual(['charmed', 'exhaustion', 'frightened', 'paralyzed', 'poisoned']);
    expect(lich.senses).toEqual({ truesight: 120 });
    expect(lich.languages).toEqual(['Common plus up to five other languages']);
    const spells = lich.traits.find((t) => t.name === 'Spellcasting')!.description.split('\n');
    expect(spells).toHaveLength(11);
    expect(spells[1]).toBe('Cantrips (at will): mage hand, prestidigitation, ray of frost');
    expect(spells[10]).toBe('9th level (1 slot): power word kill');
    expect(lich.actions[0]!.attack).toMatchObject({ kind: 'melee-spell', toHit: 12, damage: [{ formula: '3d6' }] });
    expect(lich.legendaryActions.map((a) => a.cost)).toEqual([1, 2, 2, 3]);
  });

  it('reads the gelatinous cube without languages, armor note or saving throws', () => {
    const cube = fixture('gelatinous-cube');
    expect(cube).toMatchObject({
      size: 'large',
      type: 'ooze',
      alignmentWeights: { unaligned: 1 },
      armorClass: 6,
      armorNote: '',
      hitPoints: { average: 84, formula: '8d10+40' },
      speeds: { walk: 15 },
      savingThrows: {},
      languages: [],
      senses: { blindsight: 60 },
      passivePerception: 8,
      conditionImmunities: ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'prone'],
    });
    expect(cube.actions.map((a) => [a.name, a.attack?.damage])).toEqual([
      ['Pseudopod', [{ formula: '3d6', type: 'acid' }]],
      ['Engulf', undefined],
    ]);
  });
});

const VARIANTS = `Test Wisp
Tiny swarm of Tiny beasts, neutral good (50 %) or neutral evil (50 %)

Armor Class 13 (16 with mage armor)
Hit Points 9 (2d8)
Speed 0 ft., fly 40 ft. (hover)

STR DEX CON INT WIS CHA
3 (-4) 16 (+3) 10 (+0) 6 (-2) 12 (+1) 7 (-2)

Damage Resistances bludgeoning, piercing, slashing
Senses blindsight 10 ft. or 20 ft. while deafened (blind beyond this radius), passive Perception 11
Languages understands Common but can't speak
Challenge 1/2 (100 XP)

Fey Ancestry. Sunlight Sensitivity.
Actions
Multiattack. The wisp makes two attacks.
Sting. Melee or Ranged Weapon Attack: +5 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 7 (1d6 + 1 plus 1d4) piercing damage, or 8 (2d6) piercing damage if used with two hands.
Claw. Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 3 (1d4 + 1) bludgeoning or slashing damage.
Bonus Actions
Flit. The wisp moves 10 feet.
Shove. Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 2 (1d4) bludgeoning damage.Reactions
Parry. The wisp adds 2 to its AC against one melee attack.

A wisp is a test creature.
Source: Unit Test`;

const HAND_TYPED = `Test Mage
Medium humanoid (human), lawful evil

Armor Class 12
Hit Points 22 (5d8)
Speed 30 ft.

STR 9 (-1)
DEX 14 (+2)
CON 11 (0)
INT 17 (+3)
WIS 12 (+1)
CHA 11 (0)

Skills Arcana +5, Sleight of Hand +4
Challenge 2 (450 XP)

Spellcasting. The mage is a 5th-level spellcaster. It has the following wizard spells prepared:

    Cantrips (at will): fire bolt, light

    1st level (4 slots): magic missile, shield

Actions

Dagger. Melee or Ranged Weapon Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 4 (1d4 + 2) piercing damage.`;

describe('parseStatBlock layout variants', () => {
  it('handles table abilities, hover, glued section headers, bare names, riders and the source footer', () => {
    const wisp = creatureSchema.parse(parseStatBlock(VARIANTS.replace(/\n/g, '\r\n')));
    expect(wisp).toMatchObject({
      source: 'Unit Test',
      size: 'tiny',
      type: 'beast',
      tags: ['swarm'],
      alignmentWeights: { 'neutral-good': 0.5, 'neutral-evil': 0.5 },
      armorClass: 13,
      armorNote: '16 with mage armor',
      speeds: { walk: 0, fly: 40 },
      hover: true,
      abilities: { str: 3, dex: 16, con: 10, int: 6, wis: 12, cha: 7 },
      damageResistances: ['bludgeoning', 'piercing', 'slashing'],
      senses: { blindsight: 10 },
      passivePerception: 11,
      languages: ["understands Common but can't speak"],
      challenge: 0.5,
      xp: 100,
      traits: [
        { name: 'Fey Ancestry', description: '' },
        { name: 'Sunlight Sensitivity', description: '' },
      ],
      reactions: [{ name: 'Parry', description: 'The wisp adds 2 to its AC against one melee attack.' }],
      notes: 'A wisp is a test creature.',
    });
    expect(wisp.actions.map((a) => a.attack)).toEqual([
      null,
      {
        kind: 'melee-or-ranged',
        toHit: 5,
        reachFt: 5,
        rangeFt: { normal: 20, long: 60 },
        targets: 'one target',
        damage: [{ formula: '1d6+1d4+1', type: 'piercing' }],
      },
      expect.objectContaining({ damage: [{ formula: '1d4+1', type: 'bludgeoning' }] }),
    ]);
    expect(wisp.bonusActions.map((a) => [a.name, a.attack?.toHit ?? null])).toEqual([
      ['Flit', null],
      ['Shove', 5],
    ]);
  });

  it('reads one-line-per-ability blocks with indented spell lists and derives passive Perception', () => {
    const mage = creatureSchema.parse(parseStatBlock(HAND_TYPED, { source: 'HotD', license: 'personal' }));
    expect(mage).toMatchObject({
      source: 'HotD',
      license: 'personal',
      subtype: 'human',
      abilities: { str: 9, dex: 14, con: 11, int: 17, wis: 12, cha: 11 },
      skills: { arcana: 5, 'sleight-of-hand': 4 },
      passivePerception: 11,
      languages: [],
    });
    expect(mage.traits[0]!.description).toBe(
      'The mage is a 5th-level spellcaster. It has the following wizard spells prepared:\n' +
        'Cantrips (at will): fire bolt, light\n1st level (4 slots): magic missile, shield',
    );
    expect(mage.actions[0]!.attack).toMatchObject({ kind: 'melee-or-ranged', toHit: 4 });
  });

  it('names the failing line', () => {
    const badType = () => parseStatBlock('Goblin\nSmallish humanoid, neutral evil\nArmor Class 15');
    expect(badType).toThrow(StatBlockError);
    expect(badType).toThrow(expect.objectContaining({ lineNumber: 2, line: 'Smallish humanoid, neutral evil' }));
    expect(() => parseStatBlock(HAND_TYPED.replace('Challenge 2 (450 XP)', ''))).toThrow('Missing "Challenge"');
    expect(() => parseStatBlock(HAND_TYPED.replace('Skills Arcana', 'Skills Arcanna'))).toThrow(StatBlockError);
    expect(() => parseStatBlock(HAND_TYPED.replace('lawful evil', 'mostly lawful'))).toThrow('Unknown alignment');
  });

  it('keeps the last entries when the source footer follows them without a blank line', () => {
    const wisp = parseStatBlock(VARIANTS.replace('\n\nA wisp is a test creature.', ''));
    expect(wisp.reactions.map((r) => r.name)).toEqual(['Parry']);
    expect(wisp.traits.map((t) => t.name)).toEqual(['Fey Ancestry', 'Sunlight Sensitivity']);
    expect(wisp).toMatchObject({ notes: '', source: 'Unit Test' });
  });

  it('joins a legendary intro wrapped over two lines', () => {
    const legendary =
      '\nLegendary Actions\nThe wisp can take 3 legendary actions, choosing from the options\n' +
      'below. Only one option can be used at a time.\nDart. The wisp moves.';
    const wisp = parseStatBlock(VARIANTS.replace('\n\nA wisp is a test creature.', `${legendary}\n\nA wisp.`));
    expect(wisp.legendaryDescription).toBe(
      'The wisp can take 3 legendary actions, choosing from the options below. Only one option can be used at a time.',
    );
    expect(wisp.legendaryActions.map((a) => a.name)).toEqual(['Dart']);
  });

  it('reads decimal challenge ratings and names the line of bad ones', () => {
    const cr = (text: string) => parseStatBlock(VARIANTS.replace('Challenge 1/2 (100 XP)', `Challenge ${text}`));
    expect(cr('0.5')).toMatchObject({ challenge: 0.5, xp: 100 });
    expect(() => cr('1/3')).toThrow(StatBlockError);
    expect(() => cr('1/3')).toThrow('No XP value');
    expect(() => cr('1/0 (0 XP)')).toThrow('Invalid challenge rating');
  });
});
