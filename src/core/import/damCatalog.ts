import { z } from 'zod';
import type { AssetRef } from '../model/common';
import { damObjectKinds, type DamObjectChoices } from './damObjects';
import type { DamProject } from './damProject';
import { parseJsonFile, parseOrThrow } from './importedMap';

/** Dungeon Alchemist measures models in squares. */
const FEET_PER_UNIT = 5;

export interface Size3 {
  x: number;
  /** Height. */
  y: number;
  z: number;
}

/** What Dungeon Alchemist's own database says about one object kind. */
export interface DamCatalogEntry {
  name: string;
  keywords: string[];
  /** Bounds in feet at Dungeon Alchemist's default scale; null without model data. */
  sizeFt: Size3 | null;
}

/** By Dungeon Alchemist block id. */
export type DamCatalog = Record<string, DamCatalogEntry>;

const blocksSchema = z.array(
  z.object({
    Id: z.string(),
    name: z.string(),
    keywords: z.array(z.string()).default([]),
    modelId: z.string().optional(),
    scale: z.number().positive().default(1),
  }),
);

const vectorSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const modelsSchema = z.array(
  z.object({
    Id: z.string(),
    mapColliderCache: z
      .object({ stateIndependentBounds: z.object({ extents: vectorSchema }).nullable().optional() })
      .optional(),
  }),
);

/**
 * Reads `BuildingBlocks.json` and `ModelStaticData.json` from Dungeon Alchemist's
 * `StreamingAssets/Database` folder.
 */
export function parseDamCatalog(blocksText: string, modelsText: string): DamCatalog {
  const blocks = parseOrThrow(
    blocksSchema,
    parseJsonFile(blocksText, 'BuildingBlocks.json'),
    'BuildingBlocks.json',
    'Dungeon Alchemist object list',
  );
  const models = parseOrThrow(
    modelsSchema,
    parseJsonFile(modelsText, 'ModelStaticData.json'),
    'ModelStaticData.json',
    'Dungeon Alchemist model list',
  );
  const extents = new Map(models.map((m) => [m.Id, m.mapColliderCache?.stateIndependentBounds?.extents ?? null]));
  return Object.fromEntries(
    blocks.map((block) => {
      const half = block.modelId === undefined ? null : (extents.get(block.modelId) ?? null);
      const feet = 2 * block.scale * FEET_PER_UNIT;
      const sizeFt = half && { x: half.x * feet, y: half.y * feet, z: half.z * feet };
      return [block.Id, { name: block.name, keywords: block.keywords, sizeFt }];
    }),
  );
}

/**
 * Words in a kind's name or keywords that pick a stand-in slot; first match wins: conifers
 * before other trees, ferns, flowers and ivy before other plants, shelves before cabinets.
 */
const SLOT_WORDS = [
  ['conifer', ['conifer', 'evergreen', 'pine', 'spruce', 'fir', 'cedar']],
  ['tree', ['tree', 'oak', 'birch', 'willow', 'maple']],
  ['fern', ['fern']],
  ['flower', ['flower', 'flowers', 'dandelion', 'daisy', 'blossom']],
  ['ivy', ['ivy', 'groundcover', 'weed', 'weeds', 'nettle']],
  ['bush', ['bush', 'shrub', 'hedge']],
  ['branch', ['branch', 'branches', 'twig', 'twigs']],
  ['log', ['log', 'logs']],
  ['stump', ['stump']],
  ['rock', ['rock', 'rocks', 'boulder']],
  ['table', ['table', 'desk']],
  ['chair', ['chair', 'stool']],
  ['barrel', ['barrel', 'keg', 'cask']],
  ['chest', ['chest', 'coffer']],
  ['crate', ['crate']],
  ['bed', ['bed']],
  ['shelf', ['shelf', 'bookcase', 'bookshelf']],
  ['cabinet', ['cabinet', 'cupboard', 'drawer', 'dresser', 'wardrobe']],
  ['candle', ['candle', 'candles', 'candelabra', 'candlestick']],
  ['pot', ['pot', 'urn', 'pottery', 'vase']],
  ['planter', ['planter']],
  ['firepit', ['campfire', 'firepit', 'bonfire']],
] as const satisfies readonly (readonly [string, readonly string[]])[];

/** A kind of stand-in model, such as `conifer` or `chair`. */
export type StandInSlot = (typeof SLOT_WORDS)[number][0];

/** The stand-in slot of the kind, or null when none fits (food, cutlery, …). */
export function damStandIn(entry: DamCatalogEntry): StandInSlot | null {
  const words = new Set(
    [entry.name, ...entry.keywords].flatMap((text) => text.toLowerCase().split(/[^a-z]+/)).filter(Boolean),
  );
  return SLOT_WORDS.find(([, triggers]) => triggers.some((w) => words.has(w)))?.[0] ?? null;
}

/**
 * Feet per model unit that fits a model of `modelSize` into the kind's box: as wide as the
 * kind's footprint unless that makes it taller than the kind (a thin candlestick standing in
 * for wide candles, an upright weed for flat ground cover).
 */
export function fitUnitFt(sizeFt: Size3, modelSize: Size3): number {
  const footprint = Math.max(sizeFt.x, sizeFt.z) / Math.max(modelSize.x, modelSize.z);
  return modelSize.y > 0 ? Math.min(footprint, sizeFt.y / modelSize.y) : footprint;
}

const DEFAULT_NAME = /^Object [0-9a-f]{8}$/;

/** A stand-in model with its size in model units. */
export interface DamStandInModel {
  model: AssetRef;
  size: Size3;
}

// Kinds sharing a slot (Fern, Asarum, Ivy) get different variants, the
// same kind always the same one.
function variantIndex(blockId: string, count: number): number {
  const hash = [...blockId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return hash % count;
}

/**
 * Choices for every kind of the project. Kinds Dungeon Alchemist's database knows get its name
 * where the DM kept the generated one; new kinds, and with `reassign` every kind with a stand-in,
 * get a variant of their slot's stand-in sized to the kind.
 */
export function suggestDamChoices(
  project: DamProject,
  choices: DamObjectChoices,
  catalog: DamCatalog,
  standIns: Partial<Record<StandInSlot, DamStandInModel[]>>,
  reassign: boolean,
): DamObjectChoices {
  const objects = { ...choices.objects };
  damObjectKinds(project).forEach(({ blockId }) => {
    const entry = catalog[blockId];
    const kept = objects[blockId];
    const base = kept ?? { name: `Object ${blockId.slice(0, 8)}`, model: null, unitFt: FEET_PER_UNIT, rotationDeg: 0 };
    const named = entry && (!kept || DEFAULT_NAME.test(kept.name)) ? { ...base, name: entry.name } : base;
    const slot = entry ? damStandIn(entry) : null;
    const variants = slot === null ? [] : (standIns[slot] ?? []);
    const option = variants[variantIndex(blockId, Math.max(variants.length, 1))];
    const sizeFt = entry?.sizeFt;
    objects[blockId] =
      option && sizeFt && (!kept || reassign)
        ? { ...named, model: option.model, unitFt: fitUnitFt(sizeFt, option.size) }
        : named;
  });
  return { ...choices, objects };
}
