import { z } from 'zod';
import { assetRefSchema, docHeader } from './common';

export const CREATURE_SCHEMA_VERSION = 1;

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export const abilitySchema = z.enum(ABILITIES);
export type Ability = z.infer<typeof abilitySchema>;

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export const sizeSchema = z.enum(SIZES);
export type CreatureSize = z.infer<typeof sizeSchema>;

export const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;
export const creatureTypeSchema = z.enum(CREATURE_TYPES);
export type CreatureTypeName = z.infer<typeof creatureTypeSchema>;

export const ALIGNMENTS = [
  'lawful-good',
  'neutral-good',
  'chaotic-good',
  'lawful-neutral',
  'neutral',
  'chaotic-neutral',
  'lawful-evil',
  'neutral-evil',
  'chaotic-evil',
  'unaligned',
] as const;
export const alignmentSchema = z.enum(ALIGNMENTS);
export type Alignment = z.infer<typeof alignmentSchema>;

export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;
export const damageTypeSchema = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof damageTypeSchema>;

export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;
export const conditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof conditionSchema>;

export const SKILLS = [
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
] as const;
export const skillSchema = z.enum(SKILLS);
export type Skill = z.infer<typeof skillSchema>;

export const SKILL_ABILITY: Record<Skill, Ability> = {
  acrobatics: 'dex',
  'animal-handling': 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  'sleight-of-hand': 'dex',
  stealth: 'dex',
  survival: 'wis',
};

export const SENSES = ['blindsight', 'darkvision', 'tremorsense', 'truesight'] as const;
export const senseSchema = z.enum(SENSES);
export type Sense = z.infer<typeof senseSchema>;
export const sensesSchema = z.partialRecord(senseSchema, z.number().nonnegative());
export type Senses = z.infer<typeof sensesSchema>;

export const SPEEDS = ['walk', 'burrow', 'climb', 'fly', 'swim'] as const;
export const speedSchema = z.enum(SPEEDS);
export type SpeedKind = z.infer<typeof speedSchema>;

export const ATTACK_KINDS = [
  'melee-weapon',
  'ranged-weapon',
  'melee-spell',
  'ranged-spell',
  'melee-or-ranged',
] as const;
export const attackKindSchema = z.enum(ATTACK_KINDS);
export type AttackKind = z.infer<typeof attackKindSchema>;

export const damageRollSchema = z.object({
  /** Dice expression including flat bonus, e.g. `2d6+3`. */
  formula: z.string().min(1),
  type: damageTypeSchema,
});
export type DamageRoll = z.infer<typeof damageRollSchema>;

export const attackRollSchema = z.object({
  kind: attackKindSchema,
  toHit: z.number().int(),
  reachFt: z.number().nonnegative().nullable(),
  rangeFt: z.object({ normal: z.number().nonnegative(), long: z.number().nonnegative() }).nullable(),
  targets: z.string(),
  damage: z.array(damageRollSchema),
});
export type AttackRoll = z.infer<typeof attackRollSchema>;

export const actionSchema = z.object({
  name: z.string(),
  description: z.string(),
  attack: attackRollSchema.nullable(),
});
export type CreatureAction = z.infer<typeof actionSchema>;

export const traitSchema = z.object({ name: z.string(), description: z.string() });
export type Trait = z.infer<typeof traitSchema>;

export const legendaryActionSchema = traitSchema.extend({ cost: z.number().int().positive() });
export type LegendaryAction = z.infer<typeof legendaryActionSchema>;

export const creatureKindSchema = z.enum(['monster', 'npc', 'player']);
export type CreatureKind = z.infer<typeof creatureKindSchema>;

export const creatureSchema = z.object({
  ...docHeader('creature'),
  kind: creatureKindSchema,
  source: z.string(),
  license: z.string(),
  tags: z.array(z.string()),
  size: sizeSchema,
  type: creatureTypeSchema,
  subtype: z.string(),
  /** Text shown in the stat block, e.g. "any non-lawful alignment". */
  alignmentText: z.string(),
  /** Probability per alignment used when a combatant is spawned. */
  alignmentWeights: z.partialRecord(alignmentSchema, z.number().nonnegative()),
  armorClass: z.number().int(),
  armorNote: z.string(),
  hitPoints: z.object({ average: z.number().int().nonnegative(), formula: z.string() }),
  speeds: z.partialRecord(speedSchema, z.number().nonnegative()),
  hover: z.boolean(),
  abilities: z.record(abilitySchema, z.number().int().min(1).max(30)),
  /** Total saving throw bonus per proficient ability. */
  savingThrows: z.partialRecord(abilitySchema, z.number().int()),
  /** Total skill bonus per listed skill. */
  skills: z.partialRecord(skillSchema, z.number().int()),
  damageVulnerabilities: z.array(z.string()),
  damageResistances: z.array(z.string()),
  damageImmunities: z.array(z.string()),
  conditionImmunities: z.array(conditionSchema),
  senses: sensesSchema,
  passivePerception: z.number().int(),
  languages: z.array(z.string()),
  challenge: z.number().nonnegative(),
  xp: z.number().int().nonnegative(),
  traits: z.array(traitSchema),
  actions: z.array(actionSchema),
  bonusActions: z.array(actionSchema),
  reactions: z.array(traitSchema),
  legendaryDescription: z.string(),
  legendaryActions: z.array(legendaryActionSchema),
  image: assetRefSchema.nullable(),
  token: assetRefSchema.nullable(),
  notes: z.string(),
});
export type Creature = z.infer<typeof creatureSchema>;
