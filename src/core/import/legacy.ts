import { z } from 'zod';
import {
  ABILITIES,
  ALIGNMENTS,
  CREATURE_TYPES,
  DAMAGE_TYPES,
  SENSES,
  SIZES,
  SKILLS,
  createCreature,
  createMap,
  createMarkerTemplate,
  type AttackRoll,
  type BattleMap,
  type Condition,
  type Creature,
  type CreatureAction,
  type CreatureKind,
  type MapImage,
  type MarkerTemplate,
  type Trait,
  type Vec2,
  type Wall,
} from '../model';
import { HeightField } from '../terrain/heightfield';
import { abilityModifier, formatModifier, proficiencyBonusForCr, xpForCr } from '../rules/abilities';
import { averageDice } from '../rules/dice';
import { slugId } from './ids';
import { isNameLike, legendaryAction, parseAttack } from './statblock';

/**
 * Converters for the JSON files of the WPF proof of concept (`240722_DnD_DMTool_Data`).
 * Enum values are stored as numbers there; the tables below follow the legacy C# enum order.
 */

const LEGACY_CONDITIONS: Condition[] = [
  'blinded',
  'charmed',
  'deafened',
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
  'exhaustion',
];
const LEGACY_LANGUAGES = [
  'Common',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
  'Abyssal',
  'Celestial',
  'Draconic',
  'Deep Speech',
  'Infernal',
  'Primordial',
  'Sylvan',
  'Undercommon',
  'Auran',
];
const LEGACY_ATTACK_KINDS: Record<number, AttackRoll['kind']> = {
  1: 'melee-weapon',
  2: 'ranged-weapon',
  3: 'melee-or-ranged',
};
const HIT_DIE_BY_SIZE = [4, 6, 8, 10, 12, 20];
/** Legacy tiles were 1 unit = one 5 ft square, heights in the same unit. */
const FEET_PER_UNIT = 5;
/** Legacy ground level: a tile box of height 1 is flat ground (new elevation 0). */
const LEGACY_GROUND = 1;
const LEGACY_WALL_THICKNESS_FT = 0.1 * FEET_PER_UNIT;
/** Only scales the (absent) image; any positive value works for an image-less map. */
const NO_IMAGE_PX_PER_SQUARE = 70;

const keyValueSchema = z.object({ Key: z.string(), Value: z.string() });

export const legacyCreatureSchema = z.object({
  Name: z.string(),
  ImagePath: z.string().nullish(),
  BeeingSize: z.number().int().min(0).max(5),
  BeeingType: z.number().int().min(0).max(13),
  Alignment: z.record(z.string(), z.number()),
  ArmorClass: z.number(),
  Strength: z.number(),
  Dexterity: z.number(),
  Constitution: z.number(),
  Intelligence: z.number(),
  Wisdom: z.number(),
  Charisma: z.number(),
  SavingThrowProficencyStrength: z.boolean(),
  SavingThrowProficencyDexterity: z.boolean(),
  SavingThrowProficencyConstitution: z.boolean(),
  SavingThrowProficencyIntelligence: z.boolean(),
  SavingThrowProficencyWisdom: z.boolean(),
  SavingThrowProficencyCharisma: z.boolean(),
  Challenge: z.number(),
  HitPointsDiceCount: z.number().int(),
  WalkSpeed: z.number(),
  BurrowSpeed: z.number(),
  ClimbSpeed: z.number(),
  FlySpeed: z.number(),
  SwimSpeed: z.number(),
  Abilities: z.array(keyValueSchema),
  Attacks: z.array(
    z.object({
      Name: z.string(),
      Description: z.string(),
      Reach: z.number(),
      AtkType: z.number().int(),
      NumberOfTargets: z.number().int(),
      DmgDice: z.string(),
      DmgType: z.number().int().min(0).max(12),
      AttrModBonusValue: z.number().int(),
      ProfModBonusValue: z.number().int(),
    }),
  ),
  LegendaryActionDescription: z.string().nullish(),
  LegendaryActions: z.array(keyValueSchema),
  Senses: z.record(z.string(), z.number()),
  CharacterSkills: z.record(z.string(), z.number()),
  DamageResistances: z.array(z.number().int().min(0).max(12)),
  DamageImmunities: z.array(z.number().int().min(0).max(12)),
  ConditionImmunities: z.array(z.number().int().min(0).max(14)),
  Languages: z.array(
    z
      .number()
      .int()
      .min(0)
      .max(LEGACY_LANGUAGES.length - 1),
  ),
  AverageHitPoints: z.number().int().nullish(),
});
export type LegacyCreature = z.infer<typeof legacyCreatureSchema>;

export const legacyMapSchema = z.object({
  Name: z.string(),
  MapPath: z.string(),
  TilesCountInWidth: z.number().int().positive(),
  TilesCountInLength: z.number().int().positive(),
  Tiles: z.array(
    z.object({
      BaseHeight: z.number(),
      WallTopHeight: z.number(),
      WallBottomHeight: z.number(),
      WallRightHeight: z.number(),
      WallLeftHeight: z.number(),
      X: z.number().int(),
      Y: z.number().int(),
      Ilumination: z.array(z.object({ Light: z.number(), Level: z.number() })).nullish(),
      Marking: z.array(z.unknown()).nullish(),
      PossibleMovementSpeed: z.array(z.number()).nullish(),
    }),
  ),
});
export type LegacyMap = z.infer<typeof legacyMapSchema>;

export const legacyMarkerSchema = z.object({
  Name: z.string(),
  PhysicalShapeType: z.number().int().min(0).max(4),
  Width: z.number(),
  Length: z.number(),
  ChangeIllumination: z.boolean(),
  OutlineBrush: z.string().regex(/^#[0-9a-fA-F]{8}$/),
});
export type LegacyMarker = z.infer<typeof legacyMarkerSchema>;

export interface Converted<T> {
  doc: T;
  /** Data that could not be carried over, one human readable line each. */
  warnings: string[];
}

/**
 * The legacy parser stored the page footer ("Monster Manual (SRD)") and the flavour paragraph before it as the
 * last actions or legendary actions. Returns the real entries and the flavour text.
 */
function stripFooterEntries(entries: Trait[]): { entries: Trait[]; flavor: string } {
  const footer = entries.findIndex((e) => /^Monster Manual/i.test(e.name));
  let start = footer;
  while (start > 0 && !isNameLike(entries[start - 1]!.name)) {
    start -= 1;
  }
  return footer === -1
    ? { entries, flavor: '' }
    : {
        entries: [...entries.slice(0, start), ...entries.slice(footer + 1)],
        flavor: entries
          .slice(start, footer)
          .map((e) => `${e.name}. ${e.description}`)
          .join(' '),
      };
}

function legacyAction(attack: LegacyCreature['Attacks'][number]): CreatureAction {
  const kind = LEGACY_ATTACK_KINDS[attack.AtkType];
  const bonus = attack.AttrModBonusValue;
  // Hand-made legacy attacks have no attack text, only the structured fields.
  const fromFields: AttackRoll | null = kind
    ? {
        kind,
        toHit: attack.ProfModBonusValue + bonus,
        reachFt: kind === 'ranged-weapon' ? null : attack.Reach,
        rangeFt: null,
        targets: attack.NumberOfTargets === 1 ? 'one target' : `${attack.NumberOfTargets} targets`,
        damage: [
          {
            formula: `${attack.DmgDice}${bonus === 0 ? '' : formatModifier(bonus)}`,
            type: DAMAGE_TYPES[attack.DmgType]!,
          },
        ],
      }
    : null;
  return {
    name: attack.Name,
    description: attack.Description,
    attack: parseAttack(attack.Description) ?? fromFields,
  };
}

function alignmentText(weights: Creature['alignmentWeights']): string {
  const names = Object.keys(weights).map((a) => a.replace('-', ' '));
  return names.length === 0 ? 'unaligned' : names.length >= 9 ? 'any alignment' : names.join(' or ');
}

export function convertLegacyCreature(legacy: LegacyCreature, kind: CreatureKind): Converted<Creature> {
  const warnings: string[] = [];
  const scores = [
    legacy.Strength,
    legacy.Dexterity,
    legacy.Constitution,
    legacy.Intelligence,
    legacy.Wisdom,
    legacy.Charisma,
  ];
  const abilities = Object.fromEntries(
    ABILITIES.map((a, i) => [a, scores[i]! >= 1 && scores[i]! <= 30 ? scores[i]! : 10]),
  ) as Creature['abilities'];
  if (scores.some((s) => s < 1 || s > 30)) {
    warnings.push(`ability scores ${scores.join('/')} outside 1-30 were set to 10`);
  }
  const proficient = [
    legacy.SavingThrowProficencyStrength,
    legacy.SavingThrowProficencyDexterity,
    legacy.SavingThrowProficencyConstitution,
    legacy.SavingThrowProficencyIntelligence,
    legacy.SavingThrowProficencyWisdom,
    legacy.SavingThrowProficencyCharisma,
  ];
  const proficiency = proficiencyBonusForCr(legacy.Challenge);
  const alignmentWeights: Creature['alignmentWeights'] = {};
  for (const [key, weight] of Object.entries(legacy.Alignment).filter(([, w]) => w > 0)) {
    const alignment = ALIGNMENTS.find((a) => a.replace('-', '') === key.toLowerCase());
    if (alignment === undefined) {
      throw new Error(`Unknown legacy alignment "${key}"`);
    }
    alignmentWeights[alignment] = weight;
  }
  const skills: Creature['skills'] = {};
  for (const [key, bonus] of Object.entries(legacy.CharacterSkills)) {
    const skill = SKILLS.find((s) => s.replace(/-/g, '') === key.toLowerCase());
    if (skill === undefined) {
      throw new Error(`Unknown legacy skill "${key}"`);
    }
    skills[skill] = bonus;
  }
  const senses: Creature['senses'] = {};
  for (const [key, range] of Object.entries(legacy.Senses).filter(([key]) => key !== 'PassivePerception')) {
    const sense = SENSES.find((s) => s === key.toLowerCase());
    if (sense === undefined) {
      throw new Error(`Unknown legacy sense "${key}"`);
    }
    senses[sense] = range;
  }
  const count = legacy.HitPointsDiceCount;
  const conBonus = count * abilityModifier(abilities.con);
  const dice = `${count}d${HIT_DIE_BY_SIZE[legacy.BeeingSize]}`;
  const formula = count > 0 ? `${dice}${conBonus === 0 ? '' : formatModifier(conBonus)}` : '';
  const actions = stripFooterEntries(legacy.Attacks.map((a) => ({ name: a.Name, description: a.Description })));
  const legendary = stripFooterEntries(legacy.LegendaryActions.map((e) => ({ name: e.Key, description: e.Value })));
  const keptActions = legacy.Attacks.filter((a) => actions.entries.some((e) => e.name === a.Name));
  const speeds: Creature['speeds'] = { walk: legacy.WalkSpeed };
  const otherSpeeds = {
    burrow: legacy.BurrowSpeed,
    climb: legacy.ClimbSpeed,
    fly: legacy.FlySpeed,
    swim: legacy.SwimSpeed,
  };
  for (const [speed, feet] of Object.entries(otherSpeeds).filter(([, feet]) => feet > 0)) {
    speeds[speed as keyof typeof otherSpeeds] = feet;
  }
  const challenge = legacy.Challenge;
  const base = createCreature(legacy.Name);
  return {
    doc: {
      ...base,
      id: legacyId(legacy.Name),
      kind,
      source: 'Legacy DM Tool',
      size: SIZES[legacy.BeeingSize]!,
      type: CREATURE_TYPES[legacy.BeeingType]!,
      alignmentText: alignmentText(alignmentWeights),
      alignmentWeights,
      armorClass: Math.round(legacy.ArmorClass),
      hitPoints: { average: legacy.AverageHitPoints ?? (formula === '' ? 0 : averageDice(formula)), formula },
      speeds,
      abilities,
      savingThrows: Object.fromEntries(
        ABILITIES.filter((_, i) => proficient[i]).map((a) => [a, abilityModifier(abilities[a]) + proficiency]),
      ),
      skills,
      damageResistances: legacy.DamageResistances.map((d) => DAMAGE_TYPES[d]!),
      damageImmunities: legacy.DamageImmunities.map((d) => DAMAGE_TYPES[d]!),
      conditionImmunities: legacy.ConditionImmunities.map((c) => LEGACY_CONDITIONS[c]!),
      senses,
      passivePerception: legacy.Senses.PassivePerception ?? 10 + abilityModifier(abilities.wis),
      languages: legacy.Languages.map((l) => LEGACY_LANGUAGES[l]!),
      challenge,
      xp: xpForCr(challenge),
      traits: legacy.Abilities.map((e) => ({ name: e.Key, description: e.Value })),
      actions: keptActions.map(legacyAction),
      legendaryDescription: legacy.LegendaryActionDescription ?? '',
      legendaryActions: legendary.entries.map(legendaryAction),
      notes: [actions.flavor, legendary.flavor].filter((f) => f !== '').join('\n'),
    },
    warnings,
  };
}

function edgeKey(a: Vec2, b: Vec2): string {
  const [p, q] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a];
  return `${p.x},${p.y},${q.x},${q.y}`;
}

/** Chains unit edges with equal wall heights into polylines; loops become closed walls. */
function chainEdges(edges: [Vec2, Vec2][]): { points: Vec2[]; closed: boolean }[] {
  const pointKey = (p: Vec2) => `${p.x},${p.y}`;
  const unused = new Set(edges.map((_, i) => i));
  const touching = new Map<string, number[]>();
  edges.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      touching.set(pointKey(p), [...(touching.get(pointKey(p)) ?? []), i]);
    }
  });
  const degree = (p: Vec2) => touching.get(pointKey(p))!.length;
  const walk = (start: Vec2): Vec2[] => {
    const points = [start];
    let next = touching.get(pointKey(start))!.find((i) => unused.has(i));
    while (next !== undefined) {
      unused.delete(next);
      const [a, b] = edges[next]!;
      const from = points[points.length - 1]!;
      const to = pointKey(a) === pointKey(from) ? b : a;
      points.push(to);
      next = degree(to) === 2 ? touching.get(pointKey(to))!.find((i) => unused.has(i)) : undefined;
    }
    return points;
  };
  const lines: { points: Vec2[]; closed: boolean }[] = [];
  // Open chains start at ends or junctions; whatever remains are loops.
  for (const end of edges.flat().filter((p) => degree(p) !== 2)) {
    while (touching.get(pointKey(end))!.some((i) => unused.has(i))) {
      lines.push({ points: walk(end), closed: false });
    }
  }
  while (unused.size > 0) {
    const [a] = edges[unused.values().next().value!]!;
    const points = walk(a);
    lines.push({ points: points.slice(0, -1), closed: true });
  }
  return lines.map((line) => ({ ...line, points: dropStraightPoints(line.points, line.closed) }));
}

/** Removes vertices in the middle of straight runs so a wall along 10 tiles is one segment. */
function dropStraightPoints(points: Vec2[], closed: boolean): Vec2[] {
  const n = points.length;
  return points.filter((p, i) => {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const inner = closed || (i > 0 && i < n - 1);
    const straight = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x) === 0;
    return !(inner && straight);
  });
}

/** Id of an imported legacy map or marker; stable so a re-import overwrites the earlier one. */
export function legacyId(name: string): string {
  return slugId('legacy', name);
}

/**
 * Legacy tiles become terrain samples (each sample takes the highest tile touching it, so raised tiles keep
 * their full top) and tile edge walls higher than their tile become wall polylines. Legacy wall naming:
 * "Top" is the south edge, "Bottom" the north edge, "Left" the east edge, "Right" the west edge.
 */
export function convertLegacyMap(legacy: LegacyMap, image: MapImage | null): Converted<BattleMap> {
  const warnings: string[] = [];
  const width = legacy.TilesCountInWidth;
  const length = legacy.TilesCountInLength;
  const base = createMap({
    name: legacy.Name,
    image,
    squaresX: width,
    squaresY: length,
    pxPerSquare: image ? image.widthPx / width : NO_IMAGE_PX_PER_SQUARE,
  });
  if (image && Math.abs(image.heightPx / length - image.widthPx / width) > 0.01 * (image.widthPx / width)) {
    warnings.push(
      `image ${image.widthPx}x${image.heightPx} px is not square per tile on ${width}x${length} tiles; ` +
        'the legacy app stretched it, the new map uses the width scale - recalibrate the grid',
    );
  }
  const tileHeight = new Float64Array(width * length).fill(LEGACY_GROUND);
  for (const tile of legacy.Tiles.filter((t) => t.X >= 0 && t.Y >= 0 && t.X < width && t.Y < length)) {
    tileHeight[tile.Y * width + tile.X] = tile.BaseHeight;
  }
  if (legacy.Tiles.length !== width * length) {
    warnings.push(`${legacy.Tiles.length} tiles for a ${width}x${length} map; missing tiles are flat ground`);
  }
  const field = HeightField.empty(base.grid, base.terrain.samplesPerSquare);
  const n = base.terrain.samplesPerSquare;
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      const cols = [Math.floor((c - 1) / n), Math.floor(c / n)].filter((x) => x >= 0 && x < width);
      const rows = [Math.floor((r - 1) / n), Math.floor(r / n)].filter((y) => y >= 0 && y < length);
      // A sample on a tile border sees both neighbouring tiles.
      const heights = rows.flatMap((y) => cols.map((x) => tileHeight[y * width + x]!));
      field.data[field.index(c, r)] = (Math.max(...heights) - LEGACY_GROUND) * FEET_PER_UNIT;
    }
  }
  const edges = new Map<string, { a: Vec2; b: Vec2; baseFt: number; topFt: number }>();
  for (const tile of legacy.Tiles) {
    const { X: x, Y: y } = tile;
    const sides: [number, Vec2, Vec2][] = [
      [tile.WallTopHeight, { x, y: y + 1 }, { x: x + 1, y: y + 1 }],
      [tile.WallBottomHeight, { x, y }, { x: x + 1, y }],
      [tile.WallLeftHeight, { x: x + 1, y }, { x: x + 1, y: y + 1 }],
      [tile.WallRightHeight, { x, y }, { x, y: y + 1 }],
    ];
    for (const [height, a, b] of sides.filter(([h]) => h > tile.BaseHeight)) {
      const key = edgeKey(a, b);
      const existing = edges.get(key);
      const topFt = (height - LEGACY_GROUND) * FEET_PER_UNIT;
      if (!existing || existing.topFt < topFt) {
        edges.set(key, { a, b, baseFt: (tile.BaseHeight - LEGACY_GROUND) * FEET_PER_UNIT, topFt });
      }
    }
  }
  const groups = new Map<string, [Vec2, Vec2][]>();
  for (const edge of edges.values()) {
    const key = `${edge.baseFt}|${edge.topFt}`;
    groups.set(key, [...(groups.get(key) ?? []), [edge.a, edge.b]]);
  }
  const walls: Wall[] = [...groups].flatMap(([key, group]) => {
    const [baseFt, topFt] = key.split('|').map(Number) as [number, number];
    return chainEdges(group).map((line, i) => ({
      id: `legacy-wall-${baseFt}-${topFt}-${i}`,
      points: line.points.map((p) => ({ x: p.x * FEET_PER_UNIT, y: p.y * FEET_PER_UNIT })),
      closed: line.closed,
      heightFt: topFt - baseFt,
      thicknessFt: LEGACY_WALL_THICKNESS_FT,
      baseFt,
      material: 'projected' as const,
      blocksSight: true,
      blocksMovement: true,
      blocksLight: true,
    }));
  });
  const special = legacy.Tiles.filter(
    (t) =>
      (t.Ilumination ?? []).some((i) => i.Light !== 0 || i.Level !== 0) ||
      (t.Marking ?? []).length > 0 ||
      (t.PossibleMovementSpeed ?? [0]).some((s) => s !== 0),
  );
  if (special.length > 0) {
    warnings.push(`${special.length} tiles with illumination/marking/movement data not converted; draw regions`);
  }
  return {
    doc: {
      ...base,
      id: legacyId(legacy.Name),
      terrain: { ...base.terrain, heights: field.encode() },
      walls,
    },
    warnings,
  };
}

/**
 * Legacy marker sizes are in tiles. Sphere and cylinder "Width" is a diameter, cylinder "Length" its height,
 * line "Length" its length (one tile wide), cone and cube "Width" their length and side.
 * Returns a reason string for markers that are not areas.
 */
export function convertLegacyMarker(legacy: LegacyMarker): MarkerTemplate | string {
  const shape = (['cone', 'cube', 'cylinder', 'line', 'sphere'] as const)[legacy.PhysicalShapeType]!;
  const tiles: Record<typeof shape, number> = {
    cone: legacy.Width,
    cube: legacy.Width,
    cylinder: legacy.Width / 2,
    line: legacy.Length,
    sphere: legacy.Width / 2,
  };
  const sizeFt = tiles[shape] * FEET_PER_UNIT;
  const alpha = parseInt(legacy.OutlineBrush.slice(1, 3), 16);
  const base = createMarkerTemplate(legacy.Name);
  let result: MarkerTemplate | string;
  if (legacy.ChangeIllumination) {
    result = 'changes illumination (a light source); add it as a map light instead';
  } else if (sizeFt <= 0) {
    result = `size ${legacy.Width}x${legacy.Length} tiles gives no area`;
  } else {
    result = {
      ...base,
      id: legacyId(legacy.Name),
      shape,
      sizeFt,
      widthFt: FEET_PER_UNIT,
      heightFt: shape === 'cylinder' && legacy.Length > 0 ? legacy.Length * FEET_PER_UNIT : base.heightFt,
      color: `#${legacy.OutlineBrush.slice(3).toLowerCase()}`,
      // Legacy brushes are opaque outlines; a filled area needs translucency.
      opacity: alpha === 255 ? base.opacity : alpha / 255,
    };
  }
  return result;
}
