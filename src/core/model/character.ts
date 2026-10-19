import { z } from 'zod';
import { idSchema } from './common';
import { abilitySchema, skillSchema } from './creature';
import { deathSavesSchema } from './encounter';

/**
 * A player character's full sheet, stored beside its creature as `creatures/<id>.sheet.json`: the creature
 * stays the combat summary (stat block), the sheet holds what a player reads at the table. The file name is
 * the creature id, like its pictures, so the sheet has no id of its own.
 */

export const CHARACTER_SHEET_SCHEMA_VERSION = 1;

export const PROFICIENCY_LEVELS = ['none', 'proficient', 'expertise'] as const;
export const proficiencyLevelSchema = z.enum(PROFICIENCY_LEVELS);
export type ProficiencyLevel = z.infer<typeof proficiencyLevelSchema>;

/** Total bonus as rolled, so bonuses from items and features count without the rules behind them. */
export const savingThrowSchema = z.object({ proficient: z.boolean(), bonus: z.number().int() });
export type SavingThrow = z.infer<typeof savingThrowSchema>;

export const skillCheckSchema = z.object({ proficiency: proficiencyLevelSchema, bonus: z.number().int() });
export type SkillCheck = z.infer<typeof skillCheckSchema>;

export const characterFeatureSchema = z.object({
  name: z.string(),
  /** Where it comes from, e.g. "Wood Elf", "Ranger", "Feat". */
  source: z.string(),
  /** Markdown. */
  text: z.string(),
});
export type CharacterFeature = z.infer<typeof characterFeatureSchema>;

export const SPELL_STATUSES = ['known', 'prepared', 'always-prepared'] as const;
export const spellStatusSchema = z.enum(SPELL_STATUSES);
export type SpellStatus = z.infer<typeof spellStatusSchema>;

export const characterSpellSchema = z.object({
  name: z.string(),
  /** 0 for cantrips. */
  level: z.number().int().min(0).max(9),
  status: spellStatusSchema,
  /** Class or feature granting it, e.g. "Ranger". */
  source: z.string(),
  /** Library spell id when the import found the spell; null for spells known only by name. */
  spell: idSchema.nullable(),
});
export type CharacterSpell = z.infer<typeof characterSpellSchema>;

export const spellcastingSchema = z.object({
  /** Class or feature, e.g. "Ranger". */
  source: z.string(),
  /** Ability name as the builder writes it, e.g. "Wisdom". */
  ability: z.string(),
  saveDc: z.number().int(),
  attackBonus: z.number().int(),
});
export type Spellcasting = z.infer<typeof spellcastingSchema>;

export const inventoryItemSchema = z.object({
  name: z.string(),
  /** Library item id when the import found the item; null for free text. */
  item: idSchema.nullable(),
  quantity: z.number().int().nonnegative(),
  equipped: z.boolean(),
  attuned: z.boolean(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const CURRENCIES = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
export const currencySchema = z.record(z.enum(CURRENCIES), z.number().int().nonnegative());
export type Currency = z.infer<typeof currencySchema>;

export const personalitySchema = z.object({
  traits: z.string(),
  ideals: z.string(),
  bonds: z.string(),
  flaws: z.string(),
});
export type Personality = z.infer<typeof personalitySchema>;

export const appearanceSchema = z.object({
  age: z.string(),
  height: z.string(),
  weight: z.string(),
  eyes: z.string(),
  skin: z.string(),
  hair: z.string(),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const characterSheetSchema = z.object({
  schema: z.literal('character-sheet'),
  version: z.number().int().positive(),
  race: z.string(),
  /** Class and subclass as shown, e.g. "Ranger (Hunter)". */
  classes: z.string(),
  background: z.string(),
  proficiencyBonus: z.number().int(),
  abilities: z.record(abilitySchema, z.number().int().min(1).max(30)),
  savingThrows: z.record(abilitySchema, savingThrowSchema),
  skills: z.record(skillSchema, skillCheckSchema),
  features: z.array(characterFeatureSchema),
  spellcasting: z.array(spellcastingSchema),
  spells: z.array(characterSpellSchema),
  inventory: z.array(inventoryItemSchema),
  currency: currencySchema,
  personality: personalitySchema,
  appearance: appearanceSchema,
  /** Markdown. */
  backstory: z.string(),
});
export type CharacterSheet = z.infer<typeof characterSheetSchema>;

export const PLAYER_SHEET_SCHEMA_VERSION = 1;

/** An item of the sheet's inventory as its player changed it; `name` ties it to the item it was made for. */
export const playerItemSchema = z.object({
  name: z.string(),
  quantity: z.number().int().nonnegative(),
  equipped: z.boolean(),
});
export type PlayerItem = z.infer<typeof playerItemSchema>;

/**
 * Where a party member stands between encounters: the values its last encounter left. Null after a long rest
 * and before its first encounter, so it starts with full hit points.
 */
export const characterSessionSchema = z.object({
  /** Current hit points; a lower maximum at the next spawn caps them. */
  hp: z.number().int(),
  tempHp: z.number().int().nonnegative(),
  /** Spell slots used by slot level ("1" to "9"), like `combatant.resources.slotsUsed`. */
  slotsUsed: z.record(z.string(), z.number().int().nonnegative()),
  deathSaves: deathSavesSchema,
});
export type CharacterSession = z.infer<typeof characterSessionSchema>;

/**
 * What a player changed on their sheet during a campaign, stored as `campaigns/<id>/players/<view>/sheet.json`
 * and laid over the library sheet when it is published, so pack files never change; plus the character's
 * session state, which every encounter of the campaign starts from.
 */
export const playerSheetSchema = z.object({
  schema: z.literal('player-sheet'),
  version: z.number().int().positive(),
  hitDiceUsed: z.number().int().nonnegative(),
  /** By the item's index in the library sheet's inventory. */
  inventory: z.record(z.string(), playerItemSchema),
  currency: z.partialRecord(z.enum(CURRENCIES), z.number().int().nonnegative()),
  // Absent in files written before session state existed.
  session: characterSessionSchema.nullable().default(null),
});
export type PlayerSheetOverlay = z.infer<typeof playerSheetSchema>;

export function emptyPlayerSheet(): PlayerSheetOverlay {
  return {
    schema: 'player-sheet',
    version: PLAYER_SHEET_SCHEMA_VERSION,
    hitDiceUsed: 0,
    inventory: {},
    currency: {},
    session: null,
  };
}

/** Bound of every number in a sheet edit; the DM checks the real ranges. */
export const SHEET_VALUE_MAX = 1_000_000;
/** Inventory indexes a sheet edit may name. */
export const SHEET_ITEMS_MAX = 1000;

const sheetValue = z.number().int().min(0).max(SHEET_VALUE_MAX);
const itemIndex = z
  .number()
  .int()
  .min(0)
  .max(SHEET_ITEMS_MAX - 1);

/** The sheet fields players may change; anything else is refused before it reaches the DM. */
export const sheetEditSchema = z.discriminatedUnion('field', [
  z.strictObject({ field: z.literal('hp'), value: sheetValue }),
  z.strictObject({ field: z.literal('tempHp'), value: sheetValue }),
  z.strictObject({ field: z.literal('slotsUsed'), level: z.number().int().min(1).max(9), value: sheetValue }),
  z.strictObject({ field: z.literal('hitDiceUsed'), value: sheetValue }),
  z.strictObject({
    field: z.literal('deathSaves'),
    successes: z.number().int().min(0).max(3),
    failures: z.number().int().min(0).max(3),
  }),
  z.strictObject({ field: z.literal('itemQuantity'), index: itemIndex, value: sheetValue }),
  z.strictObject({ field: z.literal('itemEquipped'), index: itemIndex, value: z.boolean() }),
  z.strictObject({ field: z.literal('currency'), coin: z.enum(CURRENCIES), value: sheetValue }),
]);
/** A sheet value a player may change, with its new value. */
export type SheetEdit = z.infer<typeof sheetEditSchema>;

/** Which value an edit changes, e.g. `slotsUsed:2`; a newer edit of the same value replaces a waiting one. */
export function sheetEditTarget(edit: SheetEdit): string {
  const part = 'level' in edit ? edit.level : 'index' in edit ? edit.index : 'coin' in edit ? edit.coin : '';
  return `${edit.field}:${part}`;
}

export const PLAYER_PENDING_SCHEMA_VERSION = 1;

/** A player's sheet edit waiting for the DM in 'approve' mode. */
export const pendingSheetEditSchema = z.object({
  id: idSchema,
  edit: sheetEditSchema,
  /** What the edit does, e.g. "Thorin: HP 12 → 7". */
  text: z.string(),
  /** The value the player saw, as JSON; a different current value means the DM changed it meanwhile. */
  before: z.string(),
});
export type PendingSheetEdit = z.infer<typeof pendingSheetEditSchema>;

/** The edits of one player waiting for the DM, oldest first: `campaigns/<id>/players/<view>/pending.json`. */
export const playerPendingSchema = z.object({
  schema: z.literal('player-pending'),
  version: z.number().int().positive(),
  edits: z.array(pendingSheetEditSchema),
});
export type PlayerPending = z.infer<typeof playerPendingSchema>;
