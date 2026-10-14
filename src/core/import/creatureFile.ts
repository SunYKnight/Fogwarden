import {
  ABILITIES,
  CREATURE_SCHEMA_VERSION,
  SENSES,
  SKILLS,
  SPEEDS,
  createCreature,
  creatureSchema,
  type AttackKind,
  type AttackRoll,
  type Creature,
  type CreatureAction,
  type Trait,
} from '../model';
import { abilityModifier, formatCr, formatModifier } from '../rules/abilities';
import { averageDice, DiceError } from '../rules/dice';
import { parseAttack, parseStatBlock, StatBlockError } from './statblock';

/**
 * Creature library files: an optional `---` delimited header of `key: value` lines for data the stat block
 * cannot show (kind, source, timestamps, notes, values the stat block text would not reproduce exactly),
 * followed by a plain stat block. Header keys are creature fields; header values win over the stat block.
 */

type HeaderKey = Exclude<keyof Creature, 'schema' | 'version' | 'id' | 'image' | 'token'>;

/** `text`: plain, indented block or JSON string; `list`: comma separated or JSON array; `json`: JSON value. */
type Codec = 'text' | 'list' | 'json';

// Literal order is the header line order.
const HEADER_CODECS: Record<HeaderKey, Codec> = {
  kind: 'text',
  level: 'json',
  source: 'text',
  license: 'text',
  tags: 'list',
  createdAt: 'text',
  updatedAt: 'text',
  name: 'text',
  size: 'text',
  type: 'text',
  subtype: 'text',
  alignmentText: 'text',
  alignmentWeights: 'json',
  armorClass: 'json',
  armorNote: 'text',
  hitPoints: 'json',
  speeds: 'json',
  hover: 'json',
  abilities: 'json',
  savingThrows: 'json',
  skills: 'json',
  damageVulnerabilities: 'json',
  damageResistances: 'json',
  damageImmunities: 'json',
  conditionImmunities: 'json',
  senses: 'json',
  passivePerception: 'json',
  languages: 'json',
  challenge: 'json',
  xp: 'json',
  traits: 'json',
  actions: 'json',
  bonusActions: 'json',
  reactions: 'json',
  legendaryDescription: 'text',
  legendaryActions: 'json',
  notes: 'text',
};
const HEADER_KEYS = Object.keys(HEADER_CODECS) as HeaderKey[];
const KEY_BY_LOWER: Record<string, HeaderKey> = Object.fromEntries(HEADER_KEYS.map((k) => [k.toLowerCase(), k]));
const DELIMITER = '---';
const HEADER_LINE = /^([A-Za-z]+)\s*:(.*)$/s;
/** Rendered for a stat block part whose real text would not parse; the header then holds the real values. */
const STAND_IN = createCreature('Unnamed');

function capitalize(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

const ATTACK_LABELS: Record<AttackKind, string> = {
  'melee-weapon': 'Melee Weapon Attack',
  'ranged-weapon': 'Ranged Weapon Attack',
  'melee-spell': 'Melee Spell Attack',
  'ranged-spell': 'Ranged Spell Attack',
  'melee-or-ranged': 'Melee or Ranged Weapon Attack',
};

/** Continuation lines are indented so they never read as a new entry or section header. */
function textLines(text: string): string[] {
  const [first = '', ...rest] = text.split('\n');
  return [first, ...rest.map((l) => (l === '' ? '' : `  ${l}`))];
}

/** Plain lines unless the exact parser would read them back differently; then one JSON string. */
function entryLines({ name, description }: Trait): string[] {
  const lines = description.split('\n');
  const plain =
    !description.includes('\r') &&
    !/^".*"$/s.test(lines[0]!) &&
    lines.every((l) => l === l.trim()) &&
    (lines.length === 1 || (lines[0] !== '' && lines[lines.length - 1] !== ''));
  const [first, ...rest] = plain ? textLines(description) : [JSON.stringify(description)];
  return ['', `${name}.${first ? ` ${first}` : ''}`, ...rest];
}

/** The attack sentence `parseAttack` reads; null when a damage formula is not dice. */
function attackSentence(attack: AttackRoll): string | null {
  const { normal, long } = attack.rangeFt ?? { normal: 0, long: 0 };
  const distance = [
    ...(attack.reachFt === null ? [] : [`reach ${attack.reachFt} ft.`]),
    ...(attack.rangeFt === null ? [] : [`range ${normal}${long === normal ? '' : `/${long}`} ft.`]),
  ];
  let damage: string | null = null;
  try {
    const rolls = attack.damage.map((d) => `${Math.max(0, averageDice(d.formula))} (${d.formula}) ${d.type} damage`);
    damage = rolls.length === 0 ? 'no damage' : rolls.join(' plus ');
  } catch (error) {
    // Formulas that are not dice cannot be written; the header keeps them.
    if (!(error instanceof DiceError)) {
      throw error;
    }
  }
  const hit = `${formatModifier(attack.toHit)} to hit, ${distance.join(' or ')}, ${attack.targets}. Hit: ${damage}.`;
  return damage === null ? null : `${ATTACK_LABELS[attack.kind]}: ${hit}`;
}

/** Attack the description implies; undefined when the description names an attack it does not spell out. */
function describedAttack(description: string): AttackRoll | null | undefined {
  let attack: AttackRoll | null | undefined;
  try {
    attack = parseAttack(description);
  } catch (error) {
    if (!(error instanceof StatBlockError)) {
      throw error;
    }
  }
  return attack;
}

/** Attack data the description does not imply goes on an extra "[... Attack: ...]" line. */
function actionLines(action: CreatureAction): string[] {
  const sentence = action.attack && attackSentence(action.attack);
  const shown = sentence && !sameValue(action.attack, describedAttack(action.description));
  return [...entryLines(action), ...(shown ? [`[${sentence}]`] : [])];
}

function sectionLines(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : ['', title, ...lines];
}

function listText(items: string[]): string {
  return items.join(items.some((i) => i.includes(',')) ? '; ' : ', ');
}

function propertyLines(label: string, value: string): string[] {
  return value === '' ? [] : [`${label} ${value}`];
}

function speedText(c: Creature): string {
  const parts = SPEEDS.filter((k) => c.speeds[k] !== undefined).map(
    (k) => `${k === 'walk' ? '' : `${k} `}${c.speeds[k]} ft.${k === 'fly' && c.hover ? ' (hover)' : ''}`,
  );
  const hoverElsewhere = c.hover && c.speeds.fly === undefined;
  return `${parts.join(', ')}${hoverElsewhere ? ' (hover)' : ''}`;
}

function abilityLines(c: Creature): string[] {
  const cells = ABILITIES.map((a) => `${c.abilities[a]} (${formatModifier(abilityModifier(c.abilities[a]))})`);
  const width = Math.max(...cells.map((cell) => cell.length)) + 1;
  return [
    '',
    ABILITIES.map((a) => a.toUpperCase().padEnd(width))
      .join('')
      .trimEnd(),
    cells
      .map((cell) => cell.padEnd(width))
      .join('')
      .trimEnd(),
    '',
  ];
}

function sensesText(c: Creature): string {
  const ranges = SENSES.filter((s) => c.senses[s] !== undefined).map((s) => `${s} ${c.senses[s]} ft.`);
  return [...ranges, `passive Perception ${c.passivePerception}`].join(', ');
}

function legendaryLines(c: Creature): string[] {
  const entries = c.legendaryActions.flatMap((a) =>
    entryLines({ name: `${a.name}${a.cost > 1 ? ` (Costs ${a.cost} Actions)` : ''}`, description: a.description }),
  );
  const intro = c.legendaryDescription === '' ? [] : ['', ...textLines(c.legendaryDescription)];
  return sectionLines('Legendary Actions', [...intro, ...entries]);
}

/**
 * Stat block parts in layout order. Each renders independently so a part whose text would not parse can be
 * swapped for the stand-in's part without touching the others.
 */
const PARTS: ((c: Creature) => string[])[] = [
  (c) => [c.name],
  (c) => [`${capitalize(c.size)} ${c.type}${c.subtype ? ` (${c.subtype})` : ''}, ${c.alignmentText}`],
  (c) => ['', `Armor Class ${c.armorClass}${c.armorNote ? ` (${c.armorNote})` : ''}`],
  (c) => [`Hit Points ${c.hitPoints.average}${c.hitPoints.formula ? ` (${c.hitPoints.formula})` : ''}`],
  (c) => [`Speed ${speedText(c)}`],
  abilityLines,
  (c) =>
    propertyLines(
      'Saving Throws',
      ABILITIES.filter((a) => c.savingThrows[a] !== undefined)
        .map((a) => `${capitalize(a)} ${formatModifier(c.savingThrows[a]!)}`)
        .join(', '),
    ),
  (c) =>
    propertyLines(
      'Skills',
      SKILLS.filter((s) => c.skills[s] !== undefined)
        .map((s) => {
          const label = s.split('-').map((w) => (w === 'of' ? w : capitalize(w)));
          return `${label.join(' ')} ${formatModifier(c.skills[s]!)}`;
        })
        .join(', '),
    ),
  (c) => propertyLines('Damage Vulnerabilities', listText(c.damageVulnerabilities)),
  (c) => propertyLines('Damage Resistances', listText(c.damageResistances)),
  (c) => propertyLines('Damage Immunities', listText(c.damageImmunities)),
  (c) => propertyLines('Condition Immunities', c.conditionImmunities.join(', ')),
  (c) => [`Senses ${sensesText(c)}`],
  (c) => [`Languages ${c.languages.length === 0 ? '-' : c.languages.join(', ')}`],
  (c) => [`Challenge ${formatCr(c.challenge)} (${c.xp.toLocaleString('en-US')} XP)`],
  (c) => c.traits.flatMap(entryLines),
  (c) => sectionLines('Actions', c.actions.flatMap(actionLines)),
  (c) => sectionLines('Bonus Actions', c.bonusActions.flatMap(actionLines)),
  (c) => sectionLines('Reactions', c.reactions.flatMap(entryLines)),
  legendaryLines,
];

function joinParts(parts: string[][]): string {
  return parts.flat().join('\n');
}

/** The creature as stat block text in the layout `parseStatBlock` reads exactly with `exact: true`. */
export function formatStatBlock(creature: Creature): string {
  return joinParts(PARTS.map((part) => part(creature)));
}

function parses(text: string): boolean {
  let ok = true;
  try {
    parseStatBlock(text, { exact: true });
  } catch (error) {
    if (!(error instanceof StatBlockError)) {
      throw error;
    }
    ok = false;
  }
  return ok;
}

/** Stat block text that parses: parts whose real text fails (checked against the stand-in) use the stand-in. */
function safeStatBlock(creature: Creature): string {
  const real = PARTS.map((part) => part(creature));
  const standIn = PARTS.map((part) => part(STAND_IN));
  const text = joinParts(real);
  return parses(text)
    ? text
    : joinParts(real.map((lines, i) => (parses(joinParts(standIn.with(i, lines))) ? lines : standIn[i]!)));
}

function sameValue(a: unknown, b: unknown): boolean {
  let same = a === b;
  if (!same && typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    same =
      Array.isArray(a) === Array.isArray(b) &&
      keys.length === Object.keys(right).length &&
      keys.every((k) => Object.hasOwn(right, k) && sameValue(left[k], right[k]));
  }
  return same;
}

/** Indented block lines (blank lines allowed) back to text: common indent and blank edges removed. */
function blockText(lines: string[]): string {
  const filled = lines.filter((l) => l.trim() !== '');
  const indent = Math.min(...filled.map((l) => /^\s*/.exec(l)![0].length));
  return lines
    .map((l) => (l.trim() === '' ? '' : l.slice(indent).trimEnd()))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Comma separated list items; also splits lines so a hand-written block lists one item per line. */
function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function decodeValue(codec: Codec, inline: string, block: string[]): unknown {
  const hasBlock = block.some((l) => l.trim() !== '');
  const text = hasBlock ? blockText(block) : inline;
  const quoted = !hasBlock && inline.startsWith(codec === 'list' ? '[' : '"');
  let value: unknown = text;
  if (codec === 'json' || quoted) {
    value = JSON.parse(text);
  } else if (codec === 'list') {
    value = splitList(text);
  }
  return value;
}

/** The most readable encoding that decodes back to `value`: plain line, indented block, then JSON. */
function encodeValue(key: HeaderKey, value: unknown): string[] {
  const codec = HEADER_CODECS[key];
  let lines = [`${key}: ${JSON.stringify(value)}`];
  if (codec === 'text' && typeof value === 'string' && !value.includes('\r')) {
    const block = value.split('\n').map((l) => (l === '' ? '' : `  ${l}`));
    if (!value.includes('\n') && value === value.trim() && !value.startsWith('"')) {
      lines = [`${key}: ${value}`.trimEnd()];
    } else if (value.includes('\n') && blockText(block) === value) {
      lines = [`${key}:`, ...block];
    }
  } else if (codec === 'list' && Array.isArray(value)) {
    const joined = value.join(', ');
    if (!joined.startsWith('[') && sameValue(splitList(joined), value)) {
      lines = [`${key}: ${joined}`.trimEnd()];
    }
  }
  return lines;
}

/** Header plus stat block; header keys appear only where the stat block alone would not reproduce the value. */
export function formatCreatureFile(creature: Creature): string {
  const statBlock = safeStatBlock(creature);
  const parsed = parseStatBlock(statBlock, { exact: true });
  const header = HEADER_KEYS.filter(
    (key) => key === 'createdAt' || key === 'updatedAt' || !sameValue(parsed[key], creature[key]),
  ).flatMap((key) => encodeValue(key, creature[key]));
  return [DELIMITER, ...header, DELIMITER, statBlock, ''].join('\n');
}

interface HeaderEntry {
  key: HeaderKey;
  line: string;
  number: number;
  inline: string;
  block: string[];
}

function headerError(message: string, line: string, index: number): never {
  throw new StatBlockError(message, line, index + 1);
}

/** Splits the header lines (between the delimiters) into entries; indented lines continue the entry above. */
function readEntries(lines: string[], start: number, end: number): HeaderEntry[] {
  const entries: HeaderEntry[] = [];
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    const last = entries[entries.length - 1];
    const match = HEADER_LINE.exec(line);
    if (line.trim() === '') {
      if (last?.inline === '') {
        last.block.push('');
      }
    } else if (/^\s/.test(line)) {
      if (!last || last.inline !== '') {
        headerError('Unexpected indented header line', line, i);
      }
      last.block.push(line);
    } else if (!match) {
      headerError('Expected "key: value" in the header', line, i);
    } else {
      const lower = match[1]!.toLowerCase();
      const key = Object.hasOwn(KEY_BY_LOWER, lower) ? KEY_BY_LOWER[lower] : undefined;
      if (key === undefined) {
        headerError(`Unknown header key "${match[1]}"`, line, i);
      }
      if (entries.some((e) => e.key === key)) {
        headerError(`Duplicate header key "${match[1]}"`, line, i);
      }
      entries.push({ key, line, number: i, inline: match[2]!.trim(), block: [] });
    }
  }
  return entries;
}

function decodeEntry(entry: HeaderEntry): unknown {
  let value: unknown;
  try {
    value = decodeValue(HEADER_CODECS[entry.key], entry.inline, entry.block);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    headerError(`Invalid JSON for "${entry.key}": ${error.message}`, entry.line, entry.number);
  }
  const result = creatureSchema.shape[entry.key].safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join('; ');
    headerError(`Invalid value for "${entry.key}": ${issues}`, entry.line, entry.number);
  }
  return result.data;
}

/** Header values by key and the index of the first stat block line. */
function readHeader(lines: string[]): { values: Partial<Creature>; end: number } {
  const start = lines.findIndex((l) => l.trim() !== '');
  const hasHeader = start !== -1 && lines[start]!.trim() === DELIMITER;
  const close = hasHeader ? lines.findIndex((l, i) => i > start && l.trimEnd() === DELIMITER) : -1;
  if (hasHeader && close === -1) {
    headerError(`Header is not closed by "${DELIMITER}"`, lines[start]!, start);
  }
  const entries = hasHeader ? readEntries(lines, start + 1, close) : [];
  return {
    values: Object.fromEntries(entries.map((e) => [e.key, decodeEntry(e)])),
    end: hasHeader ? close + 1 : 0,
  };
}

/** Reads a creature file; `id` comes from the file name, pictures are not part of the file. */
export function parseCreatureFile(text: string, id: string): Creature {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const { values, end } = readHeader(lines);
  // Blank header lines keep stat block error line numbers equal to file
  // line numbers. Without a header the text is a pasted stat block.
  const parsed = parseStatBlock(lines.map((l, i) => (i < end ? '' : l)).join('\n'), { exact: end > 0 });
  return creatureSchema.parse({
    ...parsed,
    ...values,
    schema: 'creature',
    version: CREATURE_SCHEMA_VERSION,
    id,
    image: null,
    token: null,
  });
}
