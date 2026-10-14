import { describe, expect, it } from 'vitest';
import { formatItemFile, parseItemFile } from '../items';
import { formatSpellFile, parseSpellFile } from '../spells';
import {
  dnd5eEquipmentSchema,
  dnd5eMagicItemSchema,
  dnd5eMonsterSchema,
  dnd5eSpellSchema,
  srdAreaTemplate,
  srdCreature,
  srdEquipment,
  srdMagicItem,
  srdSpell,
} from './dnd5eApi';

const LICH = {
  index: 'lich',
  name: 'Lich',
  size: 'Medium',
  type: 'undead',
  alignment: 'any evil alignment',
  armor_class: [{ type: 'natural', value: 17 }],
  hit_points: 135,
  hit_points_roll: '18d8+54',
  speed: { walk: '30 ft.' },
  strength: 11,
  dexterity: 16,
  constitution: 16,
  intelligence: 20,
  wisdom: 14,
  charisma: 16,
  proficiencies: [
    { value: 12, proficiency: { name: 'Saving Throw: INT' } },
    { value: 18, proficiency: { name: 'Skill: Arcana' } },
  ],
  damage_vulnerabilities: [],
  damage_resistances: ['cold', 'lightning', 'necrotic'],
  damage_immunities: ['poison', 'bludgeoning, piercing, and slashing from nonmagical weapons'],
  condition_immunities: [{ name: 'Poisoned' }, { name: 'Charmed' }],
  senses: { truesight: '120 ft.', passive_perception: 19 },
  languages: 'Common plus up to five other languages',
  challenge_rating: 21,
  xp: 33000,
  special_abilities: [
    {
      name: 'Legendary Resistance',
      desc: 'If the lich fails a saving throw, it can choose to succeed instead.',
      usage: { type: 'per day', times: 3, rest_types: [] },
    },
    {
      name: 'Spellcasting',
      desc:
        'The lich is an 18th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 20, ' +
        '+12 to hit with spell attacks). The lich has the following wizard spells prepared:\n\n' +
        '- Cantrips (at will): mage hand, ray of frost\n- 1st level (4 slots): magic missile, shield',
    },
  ],
  actions: [
    {
      name: 'Paralyzing Touch',
      desc: 'Melee Spell Attack: +12 to hit, reach 5 ft., one creature. Hit: 10 (3d6) cold damage.',
      attack_bonus: 12,
    },
  ],
  legendary_actions: [
    { name: 'Cantrip', desc: 'The lich casts a cantrip.' },
    { name: 'Paralyzing Touch (Costs 2 Actions)', desc: 'The lich uses its Paralyzing Touch.' },
  ],
  reactions: [],
  image: '/api/images/monsters/lich.png',
};

const SPELL = {
  index: 'fireball',
  name: 'Fireball',
  desc: [
    'A bright streak flashes from your pointing finger to a point you choose within range.',
    '***Spread.*** The fire spreads around corners.',
  ],
  higher_level: ['When you cast this spell using a spell slot of 4th level or higher, the damage increases.'],
  range: '150 feet',
  components: ['V', 'S', 'M'],
  material: 'A tiny ball of bat guano and sulfur.',
  ritual: false,
  duration: 'Up to 1 minute',
  concentration: true,
  casting_time: '1 action',
  level: 3,
  school: { index: 'evocation', name: 'Evocation' },
  classes: [{ name: 'Sorcerer' }, { name: 'Wizard' }],
  subclasses: [{ name: 'Lore' }],
  damage: [
    { damage_type: { index: 'fire', name: 'Fire' }, damage_at_slot_level: { 4: '9d6', 3: '8d6' } },
    { damage_type: { index: 'radiant', name: 'Radiant' }, damage_at_slot_level: { 3: '2d6' } },
  ],
  dc: { dc_type: { index: 'dex', name: 'DEX' }, dc_success: 'half' },
  area_of_effect: { type: 'sphere', size: 20 },
};

const STAMP = '2026-10-14T12:00:00.000Z';

const MAGIC_ITEM = {
  index: 'armor',
  name: 'Armor, +1, +2, or +3',
  equipment_category: { name: 'Armor' },
  rarity: { name: 'Varies' },
  variants: [{ index: 'armor-1', name: 'Armor, +1' }, { name: 'Armor, +2' }],
  variant: false,
  desc: [
    'Armor (light, medium, or heavy), rare (+1), very rare (+2) (requires attunement by a cleric)',
    'You have a bonus to AC while wearing this armor.',
    '| d4 | Bonus |',
    '|---|---|',
    '| 1 | +1 |',
  ],
  image: '/api/images/magic-items/armor.png',
};

const WEAPON = {
  index: 'longbow',
  name: 'Longbow',
  desc: [],
  special: [],
  equipment_category: { name: 'Weapon' },
  weapon_category: 'Martial',
  weapon_range: 'Ranged',
  category_range: 'Martial Ranged',
  cost: { quantity: 50, unit: 'gp' },
  damage: { damage_dice: '1d8', damage_type: { name: 'Piercing' } },
  range: { normal: 150, long: 600 },
  weight: 2,
  properties: [{ name: 'Ammunition' }, { name: 'Two-Handed' }],
};

const VERSATILE = {
  ...WEAPON,
  index: 'longsword',
  name: 'Longsword',
  weapon_range: 'Melee',
  category_range: 'Martial Melee',
  range: { normal: 5 },
  damage: { damage_dice: '1d8', damage_type: { name: 'Slashing' } },
  two_handed_damage: { damage_dice: '1d10', damage_type: { name: 'Slashing' } },
  properties: [{ name: 'Versatile' }],
};

const ARMOR = {
  index: 'breastplate',
  name: 'Breastplate',
  desc: [],
  special: [],
  equipment_category: { name: 'Armor' },
  armor_category: 'Medium',
  armor_class: { base: 14, dex_bonus: true, max_bonus: 2 },
  str_minimum: 0,
  stealth_disadvantage: false,
  weight: 20,
  cost: { quantity: 400, unit: 'gp' },
  contents: [],
  properties: [],
};

describe('srdCreature', () => {
  it('renders the stat block, parses it back and keeps the shipped id', () => {
    const lich = srdCreature(dnd5eMonsterSchema.parse(LICH));
    expect(lich).toMatchObject({
      id: 'srd-lich',
      name: 'Lich',
      source: 'SRD 5.1',
      license: 'CC-BY-4.0',
      armorClass: 17,
      armorNote: 'natural armor',
      hitPoints: { average: 135, formula: '18d8+54' },
      savingThrows: { int: 12 },
      skills: { arcana: 18 },
      conditionImmunities: ['charmed', 'poisoned'],
      challenge: 21,
      xp: 33000,
      image: null,
    });
    expect(lich.traits.map((t) => t.name)).toEqual(['Legendary Resistance (3/Day)', 'Spellcasting']);
    expect(lich.traits[1]!.description).toContain('\nCantrips (at will): mage hand, ray of frost\n');
    expect(lich.actions[0]!.attack?.toHit).toBe(12);
    expect(lich.legendaryActions.map((a) => [a.name, a.cost])).toEqual([
      ['Cantrip', 1],
      ['Paralyzing Touch', 2],
    ]);
    expect(lich.legendaryDescription).toContain('can take 3 legendary actions');
  });

  it('refuses a monster whose stat block reads back differently', () => {
    const actions = [{ ...LICH.actions[0]!, attack_bonus: 13 }];
    expect(() => srdCreature(dnd5eMonsterSchema.parse({ ...LICH, actions }))).toThrow(/attack bonus/);
  });

  it('notes spell and condition armor classes and refuses a monster without a base one', () => {
    const mageArmor = { type: 'spell', value: 15, spell: { name: 'Mage Armor' } };
    const lich = srdCreature(dnd5eMonsterSchema.parse({ ...LICH, armor_class: [...LICH.armor_class, mageArmor] }));
    expect(lich.armorNote).toBe('natural armor, 15 with mage armor');
    expect(() => dnd5eMonsterSchema.parse({ ...LICH, armor_class: [{ type: 'spell', value: 15 }] })).toThrow();
    expect(() => srdCreature(dnd5eMonsterSchema.parse({ ...LICH, armor_class: [mageArmor] }))).toThrow(
      /no natural, armor or dex/,
    );
  });
});

describe('srdSpell', () => {
  it('maps the spell and survives the spell file', () => {
    const spell = srdSpell(dnd5eSpellSchema.parse(SPELL));
    expect(spell).toEqual({
      id: 'srd-fireball',
      name: 'Fireball',
      level: 3,
      school: 'Evocation',
      castingTime: '1 action',
      range: '150 feet',
      components: 'V, S, M (a tiny ball of bat guano and sulfur)',
      duration: 'Concentration, up to 1 minute',
      ritual: false,
      classes: ['Sorcerer', 'Wizard'],
      source: 'SRD 5.1',
      createdAt: null,
      updatedAt: null,
      description:
        'A bright streak flashes from your pointing finger to a point you choose within range.\n\n' +
        '**Spread.** The fire spreads around corners.\n\n' +
        '**At Higher Levels.** When you cast this spell using a spell slot of 4th level or higher, the damage ' +
        'increases.',
    });
    expect(parseSpellFile(formatSpellFile(spell), spell.id)).toEqual(spell);
  });
});

describe('srdAreaTemplate', () => {
  it('makes a template with save and base slot damage, further damage types in the notes', () => {
    expect(srdAreaTemplate(dnd5eSpellSchema.parse(SPELL), STAMP)).toEqual({
      schema: 'marker',
      version: 1,
      id: 'srd-fireball',
      name: 'Fireball',
      createdAt: STAMP,
      updatedAt: STAMP,
      shape: 'sphere',
      sizeFt: 20,
      widthFt: 5,
      heightFt: 40,
      color: '#ff5a1f',
      opacity: 0.35,
      notes: 'Fireball (SRD 5.1, CC-BY-4.0); also 2d6 radiant damage',
      save: { ability: 'dex', dc: 13, damage: '8d6', damageType: 'fire', halfOnSuccess: true },
    });
  });

  it('reads line width and cylinder height from the text, cantrip damage at level 1', () => {
    const line = srdAreaTemplate(
      dnd5eSpellSchema.parse({
        ...SPELL,
        desc: ['A stroke of lightning forming a line 100 feet long and 10 feet wide blasts out from you.'],
        damage: [{ damage_type: { index: 'lightning' }, damage_at_character_level: { 5: '2d8', 1: '1d8' } }],
        dc: { dc_type: { index: 'con' }, dc_success: 'none' },
        area_of_effect: { type: 'line', size: 100 },
      }),
      STAMP,
    );
    expect(line).toMatchObject({ shape: 'line', sizeFt: 100, widthFt: 10, heightFt: 10, color: '#7fc8ff' });
    expect(line?.save).toEqual({
      ability: 'con',
      dc: 13,
      damage: '1d8',
      damageType: 'lightning',
      halfOnSuccess: false,
    });
    const cylinder = srdAreaTemplate(
      dnd5eSpellSchema.parse({
        ...SPELL,
        desc: ['A silvery beam of pale light shines down in a 5-foot-radius, 40-foot-high cylinder.'],
        area_of_effect: { type: 'cylinder', size: 5 },
      }),
      STAMP,
    );
    expect([cylinder?.sizeFt, cylinder?.heightFt]).toEqual([5, 40]);
  });

  it('leaves out the save of areas without one and skips spells without an area', () => {
    const fog = dnd5eSpellSchema.parse({
      ...SPELL,
      damage: [],
      dc: undefined,
      area_of_effect: { type: 'cube', size: 15 },
    });
    expect(srdAreaTemplate(fog, STAMP)).toMatchObject({ heightFt: 15, color: '#ffd166', save: undefined });
    expect(srdAreaTemplate(dnd5eSpellSchema.parse({ ...SPELL, area_of_effect: undefined }), STAMP)).toBeNull();
  });
});

describe('srdMagicItem', () => {
  it('reads type and attunement from the first line and lists the variants', () => {
    const item = srdMagicItem(dnd5eMagicItemSchema.parse(MAGIC_ITEM));
    expect(item).toEqual({
      id: 'srd-armor',
      name: 'Armor, +1, +2, or +3',
      type: 'Armor (light, medium, or heavy)',
      rarity: 'Varies',
      attunement: 'by a cleric',
      cost: '',
      weight: '',
      source: 'SRD 5.1',
      createdAt: null,
      updatedAt: null,
      description:
        'You have a bonus to AC while wearing this armor.\n\n| d4 | Bonus |\n|---|---|\n| 1 | +1 |\n\n' +
        '**Variants:** Armor, +1; Armor, +2',
    });
    expect(parseItemFile(formatItemFile(item), item.id)).toEqual(item);
  });

  it('marks plain attunement as yes', () => {
    const item = srdMagicItem(
      dnd5eMagicItemSchema.parse({
        ...MAGIC_ITEM,
        variants: [],
        desc: ['Wondrous item, rare (requires attunement)', 'Text.'],
      }),
    );
    expect([item.type, item.attunement, item.description]).toEqual(['Wondrous item', 'yes', 'Text.']);
  });
});

describe('srdEquipment', () => {
  it('writes weapon numbers as the first description line', () => {
    expect(srdEquipment(dnd5eEquipmentSchema.parse(WEAPON))).toMatchObject({
      id: 'srd-longbow',
      type: 'Weapon (martial ranged)',
      rarity: '',
      cost: '50 gp',
      weight: '2 lb.',
      description: '**Damage:** 1d8 piercing. **Range:** 150/600 feet. **Properties:** ammunition, two-handed',
    });
    expect(srdEquipment(dnd5eEquipmentSchema.parse(VERSATILE)).description).toBe(
      '**Damage:** 1d8 slashing. **Properties:** versatile (1d10)',
    );
  });

  it('writes armor class with the Dexterity cap', () => {
    expect(srdEquipment(dnd5eEquipmentSchema.parse(ARMOR))).toMatchObject({
      id: 'srd-breastplate',
      type: 'Armor (medium)',
      cost: '400 gp',
      weight: '20 lb.',
      description: '**Armor Class:** 14 + Dex modifier (max 2)',
    });
  });
});
