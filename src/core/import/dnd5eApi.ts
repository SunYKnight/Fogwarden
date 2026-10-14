import { z } from 'zod';
import type { Item } from '../items';
import {
  ABILITIES,
  abilitySchema,
  areaShapeSchema,
  creatureSchema,
  damageTypeSchema,
  MARKER_SCHEMA_VERSION,
  markerTemplateSchema,
  type Creature,
  type DamageType,
  SPEEDS,
  type MarkerTemplate,
} from '../model';
import { abilityModifier, formatCr, formatModifier } from '../rules/abilities';
import type { Spell } from '../spells';
import { parseStatBlock } from './statblock';

/**
 * Documents of the D&D 5e API (https://www.dnd5eapi.co/api/2014, the data of 5e-bits/5e-database, SRD 5.1
 * text under CC-BY-4.0): monsters, spells with their areas, magic items and equipment. Monsters are rendered as
 * stat block text and read back with the app's stat block parser; structured values cross-check the result.
 * Every id is `srd-<API index>`, matching the shipped SRD pack's ids.
 */

export const SRD_SOURCE = 'SRD 5.1';
export const SRD_LICENSE = 'CC-BY-4.0';
export const SRD_ID_PREFIX = 'srd-';

const named = z.object({ name: z.string() });
const usageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('per day'), times: z.number() }),
  z.object({ type: z.literal('recharge on roll'), min_value: z.number() }),
  z.object({ type: z.literal('recharge after rest'), rest_types: z.array(z.string()) }),
]);
const entrySchema = z.object({ name: z.string(), desc: z.string(), usage: usageSchema.optional() });

export const dnd5eMonsterSchema = z.object({
  index: z.string(),
  name: z.string(),
  size: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  alignment: z.string(),
  armor_class: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.enum(['natural', 'armor', 'dex']),
        value: z.number(),
        armor: z.array(named).optional(),
        desc: z.string().optional(),
      }),
      z.object({ type: z.literal('spell'), value: z.number(), spell: named }),
      z.object({ type: z.literal('condition'), value: z.number(), condition: named }),
    ]),
  ),
  hit_points: z.number(),
  hit_points_roll: z.string(),
  speed: z.record(z.string(), z.union([z.string(), z.boolean()])),
  strength: z.number(),
  dexterity: z.number(),
  constitution: z.number(),
  intelligence: z.number(),
  wisdom: z.number(),
  charisma: z.number(),
  proficiencies: z.array(z.object({ value: z.number(), proficiency: named })),
  damage_vulnerabilities: z.array(z.string()),
  damage_resistances: z.array(z.string()),
  damage_immunities: z.array(z.string()),
  condition_immunities: z.array(named),
  senses: z.record(z.string(), z.union([z.string(), z.number()])),
  languages: z.string(),
  challenge_rating: z.number(),
  xp: z.number(),
  special_abilities: z.array(entrySchema).optional(),
  actions: z.array(entrySchema.extend({ attack_bonus: z.number().optional() })).optional(),
  reactions: z.array(entrySchema).optional(),
  legendary_actions: z.array(entrySchema).optional(),
  desc: z.string().optional(),
});
export type Dnd5eMonster = z.infer<typeof dnd5eMonsterSchema>;
type Entry = z.infer<typeof entrySchema>;

export const dnd5eSpellSchema = z.object({
  index: z.string(),
  name: z.string(),
  desc: z.array(z.string()),
  higher_level: z.array(z.string()).optional(),
  range: z.string(),
  components: z.array(z.string()),
  material: z.string().optional(),
  ritual: z.boolean(),
  duration: z.string(),
  concentration: z.boolean(),
  casting_time: z.string(),
  level: z.number().int().min(0).max(9),
  school: named,
  classes: z.array(named),
  area_of_effect: z.object({ type: areaShapeSchema, size: z.number().positive() }).optional(),
  dc: z.object({ dc_type: z.object({ index: abilitySchema }), dc_success: z.string() }).optional(),
  damage: z
    .array(
      z.object({
        damage_type: z.object({ index: damageTypeSchema }).optional(),
        damage_at_slot_level: z.record(z.string(), z.string()).optional(),
        damage_at_character_level: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),
});
export type Dnd5eSpell = z.infer<typeof dnd5eSpellSchema>;

export const dnd5eMagicItemSchema = z.object({
  index: z.string(),
  name: z.string(),
  equipment_category: named,
  rarity: named,
  variants: z.array(named),
  desc: z.array(z.string()),
});
export type Dnd5eMagicItem = z.infer<typeof dnd5eMagicItemSchema>;

const amountSchema = z.object({ quantity: z.number(), unit: z.string() });
const damageSchema = z.object({ damage_dice: z.string(), damage_type: named });
const rangeSchema = z.object({ normal: z.number(), long: z.number().optional() });

export const dnd5eEquipmentSchema = z.object({
  index: z.string(),
  name: z.string(),
  desc: z.array(z.string()),
  special: z.array(z.string()).optional(),
  equipment_category: named,
  gear_category: named.optional(),
  tool_category: z.string().optional(),
  vehicle_category: z.string().optional(),
  category_range: z.string().optional(),
  armor_category: z.string().optional(),
  cost: amountSchema,
  weight: z.number().optional(),
  quantity: z.number().optional(),
  damage: damageSchema.optional(),
  two_handed_damage: damageSchema.optional(),
  weapon_range: z.string().optional(),
  range: rangeSchema.optional(),
  throw_range: rangeSchema.optional(),
  properties: z.array(named).optional(),
  armor_class: z.object({ base: z.number(), dex_bonus: z.boolean(), max_bonus: z.number().optional() }).optional(),
  str_minimum: z.number().optional(),
  stealth_disadvantage: z.boolean().optional(),
  speed: amountSchema.optional(),
  capacity: z.string().optional(),
  contents: z.array(z.object({ item: named, quantity: z.number() })).optional(),
});
export type Dnd5eEquipment = z.infer<typeof dnd5eEquipmentSchema>;

// --- monsters ---

function usageSuffix(entry: Entry): string {
  const usage = entry.usage;
  let suffix = '';
  if (usage && !entry.name.includes('(')) {
    switch (usage.type) {
      case 'per day':
        suffix = ` (${usage.times}/Day)`;
        break;
      case 'recharge on roll':
        suffix = usage.min_value === 6 ? ' (Recharge 6)' : ` (Recharge ${usage.min_value}-6)`;
        break;
      case 'recharge after rest':
        suffix = usage.rest_types.includes('short')
          ? ' (Recharges after a Short or Long Rest)'
          : ' (Recharges after a Long Rest)';
        break;
    }
  }
  return suffix;
}

/** One line per entry; spell list bullets are folded in and re-split by the parser. */
function entryLine(entry: Entry): string {
  return `${entry.name}${usageSuffix(entry)}. ${entry.desc.replace(/\s*\n+\s*(?:-\s*)?/g, ' ').trim()}`;
}

function armorClass(m: Dnd5eMonster): string {
  const base = m.armor_class.flatMap((a) => (a.type === 'spell' || a.type === 'condition' ? [] : [a]));
  if (base.length === 0) {
    throw new Error(`${m.name}: no natural, armor or dex armor class`);
  }
  const value = Math.max(...base.map((a) => a.value));
  const notes = [
    ...base.flatMap((a) => [
      ...(a.type === 'natural' ? ['natural armor'] : []),
      ...(a.armor ?? []).map((x) => x.name.toLowerCase()),
      ...(a.desc ? [a.desc] : []),
    ]),
    ...m.armor_class.flatMap((a) => {
      const condition = a.type === 'condition' ? [`${a.value} while ${a.condition.name.toLowerCase()}`] : [];
      return a.type === 'spell' ? [`${a.value} with ${a.spell.name.toLowerCase()}`] : condition;
    }),
  ];
  return `${value}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
}

function speedLine(m: Dnd5eMonster): string {
  const kinds = SPEEDS.filter((k) => typeof m.speed[k] === 'string');
  const parts = kinds.map(
    (k) => `${k === 'walk' ? '' : `${k} `}${m.speed[k]}${k === 'fly' && m.speed.hover ? ' (hover)' : ''}`,
  );
  return (m.speed.walk === undefined ? ['0 ft.', ...parts] : parts).join(', ');
}

function proficiencyLine(m: Dnd5eMonster, prefix: string): string {
  return m.proficiencies
    .filter((p) => p.proficiency.name.startsWith(prefix))
    .map((p) => `${p.proficiency.name.slice(prefix.length)} ${formatModifier(p.value)}`)
    .join(', ');
}

/** The monster as stat block text in the layout the legacy raw files use. */
function renderStatBlock(m: Dnd5eMonster): string {
  const scores = [m.strength, m.dexterity, m.constitution, m.intelligence, m.wisdom, m.charisma];
  const type = `${m.type}${m.subtype ? ` (${m.subtype})` : ''}`;
  const senses = Object.entries(m.senses)
    .filter(([k]) => k !== 'passive_perception')
    .map(([k, v]) => `${k} ${v}`);
  const optional: [string, string][] = [
    ['Saving Throws', proficiencyLine(m, 'Saving Throw: ')],
    ['Skills', proficiencyLine(m, 'Skill: ')],
    ['Damage Vulnerabilities', m.damage_vulnerabilities.join('; ')],
    ['Damage Resistances', m.damage_resistances.join('; ')],
    ['Damage Immunities', m.damage_immunities.join('; ')],
    // Alphabetical; the dataset lists some creatures' conditions unsorted.
    [
      'Condition Immunities',
      m.condition_immunities
        .map((c) => c.name.toLowerCase())
        .sort()
        .join(', '),
    ],
  ];
  const lowerName = m.name.toLowerCase();
  const sections: [string, Entry[] | undefined, string[]][] = [
    ['Actions', m.actions, []],
    ['Reactions', m.reactions, []],
    [
      'Legendary Actions',
      m.legendary_actions,
      // Missing in the dataset; every SRD legendary creature has 3 actions.
      [
        `The ${lowerName} can take 3 legendary actions, choosing from the options below. Only one legendary ` +
          `action option can be used at a time and only at the end of another creature's turn. The ${lowerName} ` +
          'regains spent legendary actions at the start of its turn.',
      ],
    ],
  ];
  return [
    m.name,
    `${m.size} ${type}, ${m.alignment}`,
    '',
    `Armor Class ${armorClass(m)}`,
    `Hit Points ${m.hit_points} (${m.hit_points_roll})`,
    `Speed ${speedLine(m)}`,
    '',
    ...ABILITIES.flatMap((a, i) => [
      `${a.toUpperCase()} ${scores[i]} (${formatModifier(abilityModifier(scores[i]!))})`,
      '',
    ]),
    ...optional.filter(([, value]) => value !== '').map(([label, value]) => `${label} ${value}`),
    `Senses ${[...senses, `passive Perception ${m.senses.passive_perception}`].join(', ')}`,
    `Languages ${m.languages === '' ? '-' : m.languages}`,
    `Challenge ${formatCr(m.challenge_rating)} (${m.xp} XP)`,
    '',
    ...(m.special_abilities ?? []).map(entryLine),
    ...sections
      .filter(([, entries]) => entries && entries.length > 0)
      .flatMap(([header, entries, intro]) => [header, ...intro, ...entries!.map(entryLine)]),
  ].join('\n');
}

function check(m: Dnd5eMonster, c: Creature): void {
  const scores = [m.strength, m.dexterity, m.constitution, m.intelligence, m.wisdom, m.charisma];
  const attackBonuses = (m.actions ?? []).filter((a) => a.attack_bonus !== undefined);
  const mismatches = [
    c.hitPoints.average !== m.hit_points && `hit points ${c.hitPoints.average}`,
    c.challenge !== m.challenge_rating && `challenge ${c.challenge}`,
    c.xp !== m.xp && `xp ${c.xp}`,
    ABILITIES.some((a, i) => c.abilities[a] !== scores[i]) && 'ability scores',
    c.actions.length !== (m.actions ?? []).length && `${c.actions.length} actions`,
    c.legendaryActions.length !== (m.legendary_actions ?? []).length &&
      `${c.legendaryActions.length} legendary actions`,
    attackBonuses.some((a) => {
      const parsed = c.actions.find((p) => p.name.startsWith(a.name))?.attack;
      return parsed && parsed.toHit !== a.attack_bonus;
    }) && 'attack bonus',
  ].filter((x) => x !== false);
  if (mismatches.length > 0) {
    throw new Error(`${m.name}: parsed values differ from the dataset: ${mismatches.join(', ')}`);
  }
}

/** The monster as creature `srd-<index>`; throws when the parsed stat block disagrees with the API's values. */
export function srdCreature(m: Dnd5eMonster): Creature {
  const parsed = parseStatBlock(renderStatBlock(m), { source: SRD_SOURCE, license: SRD_LICENSE });
  check(m, parsed);
  return creatureSchema.parse({
    ...parsed,
    id: `${SRD_ID_PREFIX}${m.index}`,
    notes: m.desc?.replace(/\*\*/g, '') ?? '',
  });
}

// --- text ---

const TABLE_ROW = /^\s*\|/;
const LIST_ITEM = /^\s*[-*] /;

/**
 * API text entries as the app's Markdown: an entry per paragraph, table rows and list items on consecutive
 * lines; `***Name.***` (bold italic, which the app's Markdown lacks) becomes bold.
 */
function markdown(entries: readonly string[]): string {
  const sameBlock = (a: string, b: string) => [TABLE_ROW, LIST_ITEM].some((p) => p.test(a) && p.test(b));
  return entries
    .map((entry) => entry.replace(/\*\*\*([^*]+)\*\*\*/g, '**$1**'))
    .map((entry, i, all) => (i === 0 ? entry : `${sameBlock(all[i - 1]!, entry) ? '\n' : '\n\n'}${entry}`))
    .join('');
}

// --- spells ---

/** "V, S, M (a tiny ball of bat guano and sulfur)" as in the books. */
function componentsText(spell: Dnd5eSpell): string {
  const material = spell.material?.replace(/\.$/, '') ?? '';
  return spell.components
    .map((c) => (c === 'M' && material !== '' ? `M (${material[0]!.toLowerCase()}${material.slice(1)})` : c))
    .join(', ');
}

export function srdSpell(spell: Dnd5eSpell): Spell {
  const [higher, ...moreHigher] = spell.higher_level ?? [];
  const duration = spell.concentration
    ? `Concentration, ${spell.duration[0]!.toLowerCase()}${spell.duration.slice(1)}`
    : spell.duration;
  return {
    id: `${SRD_ID_PREFIX}${spell.index}`,
    name: spell.name,
    level: spell.level,
    school: spell.school.name,
    castingTime: spell.casting_time,
    range: spell.range,
    components: componentsText(spell),
    duration,
    ritual: spell.ritual,
    classes: spell.classes.map((c) => c.name),
    source: SRD_SOURCE,
    createdAt: null,
    updatedAt: null,
    description: markdown([...spell.desc, ...(higher ? [`**At Higher Levels.** ${higher}`, ...moreHigher] : [])]),
  };
}

// --- spell areas ---

// The shipped templates' colors where they have one.
const DAMAGE_COLORS: Record<DamageType, string> = {
  acid: '#9bd53a',
  bludgeoning: '#a68a64',
  cold: '#9fe3ff',
  fire: '#ff5a1f',
  force: '#c77dff',
  lightning: '#7fc8ff',
  necrotic: '#6b3f7a',
  piercing: '#b5b5b5',
  poison: '#6fbf3a',
  psychic: '#ff7fd1',
  radiant: '#e6ecff',
  slashing: '#c9c9c9',
  thunder: '#8a7dff',
};
const NO_DAMAGE_COLOR = '#ffd166';
// The schema wants a type also for saves without damage, which ignore it.
const NO_DAMAGE_TYPE: DamageType = 'force';
// Spell save DC 13 is a typical caster's (8 + proficiency 2 + ability 3), as
// in the shipped templates; the DM sets the real one in Play.
const PLACEHOLDER_DC = 13;
const HEIGHT_TEXT = /(\d+)[- ](?:foot|feet)[- ](?:high|tall)/i;
const WIDTH_TEXT = /(\d+)[- ](?:foot|feet)[- ](?:wide|thick)/i;

type SpellDamage = NonNullable<Dnd5eSpell['damage']>[number];

/** Dice at the spell's own slot level, or a cantrip's at character level 1: the lowest level listed. */
function baseDice(damage: SpellDamage): string {
  const byLevel = Object.entries(damage.damage_at_slot_level ?? damage.damage_at_character_level ?? {});
  return byLevel.sort(([a], [b]) => Number(a) - Number(b))[0]?.[1] ?? '';
}

/**
 * The spell's area as template `srd-<index>`, null for spells without one. Lines are 5 ft wide and heights
 * those of the shipped templates (twice the radius, cube side, cone length, line width) unless the text says
 * otherwise; the save takes the first damage type, further ones go into the notes.
 */
export function srdAreaTemplate(spell: Dnd5eSpell, timestamp: string): MarkerTemplate | null {
  const area = spell.area_of_effect;
  let template: MarkerTemplate | null = null;
  if (area) {
    const text = spell.desc.join(' ');
    const widthFt = area.type === 'line' ? Number(WIDTH_TEXT.exec(text)?.[1] ?? 5) : 5;
    const defaultHeight =
      area.type === 'line' ? widthFt : area.type === 'cube' || area.type === 'cone' ? area.size : 2 * area.size;
    const [first, ...more] = (spell.damage ?? []).filter((d) => d.damage_type);
    const also = more.map((d) => `${baseDice(d)} ${d.damage_type!.index}`).join(', ');
    template = markerTemplateSchema.parse({
      schema: 'marker',
      version: MARKER_SCHEMA_VERSION,
      id: `${SRD_ID_PREFIX}${spell.index}`,
      name: spell.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      shape: area.type,
      sizeFt: area.size,
      widthFt,
      heightFt: Number(HEIGHT_TEXT.exec(text)?.[1] ?? defaultHeight),
      color: first ? DAMAGE_COLORS[first.damage_type!.index] : NO_DAMAGE_COLOR,
      opacity: 0.35,
      notes: `${spell.name} (${SRD_SOURCE}, ${SRD_LICENSE})${also === '' ? '' : `; also ${also} damage`}`,
      save: spell.dc && {
        ability: spell.dc.dc_type.index,
        dc: PLACEHOLDER_DC,
        damage: first ? baseDice(first) : '',
        damageType: first ? first.damage_type!.index : NO_DAMAGE_TYPE,
        halfOnSuccess: spell.dc.dc_success === 'half',
      },
    });
  }
  return template;
}

// --- magic items ---

/** First description entry: "Armor (light, medium, or heavy), rare (requires attunement by a cleric)". */
const MAGIC_ITEM_SUBTITLE = /^([^,(]+(?:\([^)]*\))?)\s*,\s*(.*)$/;
const ATTUNEMENT = /\(requires attunement(?: ([^)]*))?\)/i;

export function srdMagicItem(item: Dnd5eMagicItem): Item {
  const subtitle = MAGIC_ITEM_SUBTITLE.exec(item.desc[0] ?? '');
  const attunement = subtitle ? ATTUNEMENT.exec(subtitle[2]!) : null;
  const variants = item.variants.map((v) => v.name).join('; ');
  return {
    id: `${SRD_ID_PREFIX}${item.index}`,
    name: item.name,
    type: subtitle ? subtitle[1]!.trim() : item.equipment_category.name,
    rarity: item.rarity.name,
    attunement: attunement ? (attunement[1] ?? 'yes') : '',
    cost: '',
    weight: '',
    source: SRD_SOURCE,
    createdAt: null,
    updatedAt: null,
    description: markdown([
      ...(subtitle ? item.desc.slice(1) : item.desc),
      ...(variants === '' ? [] : [`**Variants:** ${variants}`]),
    ]),
  };
}

// --- equipment ---

// Subcategories every item of the category has, which say nothing.
const PLAIN_SUBCATEGORIES: Record<string, true> = { 'Standard Gear': true, 'Other Tools': true };

/** "Weapon (martial melee)", "Armor (heavy)", "Adventuring Gear (equipment packs)" like the Aurora import. */
function equipmentType(item: Dnd5eEquipment): string {
  const category = item.equipment_category.name;
  const sub =
    item.category_range ??
    item.armor_category ??
    item.gear_category?.name ??
    item.tool_category ??
    item.vehicle_category ??
    '';
  return sub === '' || Object.hasOwn(PLAIN_SUBCATEGORIES, sub) ? category : `${category} (${sub.toLowerCase()})`;
}

/** Weapon, armor and mount numbers as a first description line, in the Aurora import's form. */
function equipmentStatLine(item: Dnd5eEquipment): string {
  const versatile = item.two_handed_damage?.damage_dice;
  const properties = (item.properties ?? []).map((p) =>
    p.name === 'Versatile' && versatile ? `versatile (${versatile})` : p.name.toLowerCase(),
  );
  const range = item.weapon_range === 'Ranged' ? item.range : item.throw_range;
  const ac = item.armor_class;
  const dex = ac?.dex_bonus ? ` + Dex modifier${ac.max_bonus === undefined ? '' : ` (max ${ac.max_bonus})`}` : '';
  const parts = [
    item.damage ? `**Damage:** ${item.damage.damage_dice} ${item.damage.damage_type.name.toLowerCase()}` : '',
    range ? `**Range:** ${range.normal}${range.long === undefined ? '' : `/${range.long}`} feet` : '',
    properties.length > 0 ? `**Properties:** ${properties.join(', ')}` : '',
    ac ? `**Armor Class:** ${item.armor_category === 'Shield' ? `+${ac.base}` : `${ac.base}${dex}`}` : '',
    item.str_minimum ? `**Strength:** ${item.str_minimum}` : '',
    item.stealth_disadvantage ? '**Stealth:** Disadvantage' : '',
    item.speed ? `**Speed:** ${item.speed.quantity} ${item.speed.unit}` : '',
    item.capacity ? `**Carrying Capacity:** ${item.capacity}` : '',
    item.quantity ? `**Quantity:** ${item.quantity}` : '',
  ];
  return parts.filter((p) => p !== '').join('. ');
}

export function srdEquipment(item: Dnd5eEquipment): Item {
  const contents = (item.contents ?? []).map((c) => `- ${c.item.name}${c.quantity > 1 ? ` (${c.quantity})` : ''}`);
  return {
    id: `${SRD_ID_PREFIX}${item.index}`,
    name: item.name,
    type: equipmentType(item),
    rarity: '',
    attunement: '',
    cost: item.cost.quantity > 0 ? `${item.cost.quantity} ${item.cost.unit}` : '',
    weight: item.weight ? `${item.weight} lb.` : '',
    source: SRD_SOURCE,
    createdAt: null,
    updatedAt: null,
    description: markdown(
      [equipmentStatLine(item), ...item.desc, ...(item.special ?? []), ...contents].filter((p) => p !== ''),
    ),
  };
}
