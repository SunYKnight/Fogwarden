import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { parseStatBlock } from '../src/core/import/statblock';
import {
  ABILITIES,
  CREATURE_SCHEMA_VERSION,
  MARKER_SCHEMA_VERSION,
  creatureSchema,
  markerTemplateSchema,
  type AreaShape,
  type Creature,
  type MarkerTemplate,
} from '../src/core/model';
import { abilityModifier, formatCr, formatModifier } from '../src/core/rules/abilities';
import { CONTENT_ROOT } from './cli';

/**
 * Builds the shipped SRD 5.1 content (`content/creatures`, `content/markers`).
 * Source: 5e-bits/5e-database (MIT), whose monster data is SRD 5.1 text (CC-BY-4.0). Each monster is rendered
 * as stat block text and read back with the app's stat block parser, so shipped and imported creatures share
 * one conversion; structured dataset values cross-check the result.
 * Usage: pnpm tsx tools/build-srd.ts [--input <5e-SRD-Monsters.json>]
 */
const DATASET_URL =
  'https://raw.githubusercontent.com/5e-bits/5e-database/a6212beb4b278917c2cff41c2b04c4ef4f3e0d6f/src/2014/en/5e-SRD-Monsters.json';
const SOURCE = 'SRD 5.1';
const LICENSE = 'CC-BY-4.0';
// Fixed timestamps (SRD 5.1 CC release) keep regenerated files identical.
const TIMESTAMP = '2023-01-27T00:00:00.000Z';

const named = z.object({ name: z.string() });
const usageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('per day'), times: z.number() }),
  z.object({ type: z.literal('recharge on roll'), min_value: z.number() }),
  z.object({ type: z.literal('recharge after rest'), rest_types: z.array(z.string()) }),
]);
const entrySchema = z.object({ name: z.string(), desc: z.string(), usage: usageSchema.optional() });
const monsterSchema = z.object({
  index: z.string(),
  name: z.string(),
  size: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  alignment: z.string(),
  armor_class: z.array(
    z.object({
      type: z.enum(['natural', 'armor', 'dex', 'spell', 'condition']),
      value: z.number(),
      armor: z.array(named).optional(),
      desc: z.string().optional(),
      spell: named.optional(),
      condition: named.optional(),
    }),
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
type Monster = z.infer<typeof monsterSchema>;
type Entry = z.infer<typeof entrySchema>;

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

function armorClass(m: Monster): string {
  const base = m.armor_class.filter((a) => a.type === 'natural' || a.type === 'armor' || a.type === 'dex');
  const value = Math.max(...base.map((a) => a.value));
  const notes = [
    ...base.flatMap((a) => [
      ...(a.type === 'natural' ? ['natural armor'] : []),
      ...(a.armor ?? []).map((x) => x.name.toLowerCase()),
      ...(a.desc ? [a.desc] : []),
    ]),
    ...m.armor_class
      .filter((a) => a.type === 'spell' || a.type === 'condition')
      .map(
        (a) =>
          `${a.value} ${a.spell ? `with ${a.spell.name.toLowerCase()}` : `while ${a.condition!.name.toLowerCase()}`}`,
      ),
  ];
  return `${value}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
}

function speedLine(m: Monster): string {
  const kinds = ['walk', 'burrow', 'climb', 'fly', 'swim'].filter((k) => typeof m.speed[k] === 'string');
  const parts = kinds.map(
    (k) => `${k === 'walk' ? '' : `${k} `}${m.speed[k]}${k === 'fly' && m.speed.hover ? ' (hover)' : ''}`,
  );
  return (m.speed.walk === undefined ? ['0 ft.', ...parts] : parts).join(', ');
}

function proficiencyLine(m: Monster, prefix: string): string {
  return m.proficiencies
    .filter((p) => p.proficiency.name.startsWith(prefix))
    .map((p) => `${p.proficiency.name.slice(prefix.length)} ${formatModifier(p.value)}`)
    .join(', ');
}

/** The monster as stat block text in the layout the legacy raw files use. */
function renderStatBlock(m: Monster): string {
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
    ['Condition Immunities', m.condition_immunities.map((c) => c.name.toLowerCase()).join(', ')],
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

function check(m: Monster, c: Creature): void {
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

function writeDocs(dir: string, docs: { id: string }[]): void {
  mkdirSync(dir, { recursive: true });
  const fresh = new Set(docs.map((d) => `${d.id}.json`));
  for (const stale of readdirSync(dir).filter((n) => n.startsWith('srd-') && !fresh.has(n))) {
    rmSync(join(dir, stale));
  }
  for (const doc of docs) {
    writeFileSync(join(dir, `${doc.id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  }
}

const MARKERS: { name: string; shape: AreaShape; sizeFt: number; widthFt: number; heightFt: number; color: string }[] =
  [
    { name: 'Fireball', shape: 'sphere', sizeFt: 20, widthFt: 5, heightFt: 40, color: '#ff5a1f' },
    { name: 'Burning Hands', shape: 'cone', sizeFt: 15, widthFt: 5, heightFt: 15, color: '#ff9b2f' },
    { name: 'Lightning Bolt', shape: 'line', sizeFt: 100, widthFt: 5, heightFt: 5, color: '#7fc8ff' },
    { name: 'Thunderwave', shape: 'cube', sizeFt: 15, widthFt: 5, heightFt: 15, color: '#8a7dff' },
    { name: 'Moonbeam', shape: 'cylinder', sizeFt: 5, widthFt: 5, heightFt: 40, color: '#e6ecff' },
  ];

const { values } = parseArgs({ options: { input: { type: 'string' } } });
const raw = values.input ? readFileSync(values.input, 'utf8') : await (await fetch(DATASET_URL)).text();
const monsters = z.array(monsterSchema).parse(JSON.parse(raw));
const header = { version: CREATURE_SCHEMA_VERSION, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
const creatures = monsters.map((m) => {
  const parsed = parseStatBlock(renderStatBlock(m), { source: SOURCE, license: LICENSE });
  check(m, parsed);
  return creatureSchema.parse({
    ...parsed,
    ...header,
    id: `srd-${m.index}`,
    notes: m.desc?.replace(/\*\*/g, '') ?? '',
  });
});
const markers: MarkerTemplate[] = MARKERS.map((m) =>
  markerTemplateSchema.parse({
    schema: 'marker',
    ...header,
    version: MARKER_SCHEMA_VERSION,
    id: `srd-${m.name.toLowerCase().replace(/\s+/g, '-')}`,
    ...m,
    opacity: 0.35,
    notes: `${m.name} (${SOURCE}, ${LICENSE})`,
  }),
);
writeDocs(join(CONTENT_ROOT, 'creatures'), creatures);
writeDocs(join(CONTENT_ROOT, 'markers'), markers);
console.log(`Wrote ${creatures.length} creatures and ${markers.length} marker templates to ${CONTENT_ROOT}`);
