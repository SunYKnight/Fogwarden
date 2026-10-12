import {
  ABILITIES,
  ALIGNMENTS,
  CONDITIONS,
  CREATURE_TYPES,
  DAMAGE_TYPES,
  SIZES,
  SKILLS,
  createCreature,
  type Ability,
  type Alignment,
  type AttackKind,
  type AttackRoll,
  type Creature,
  type CreatureAction,
  type CreatureSize,
  type CreatureTypeName,
  type DamageRoll,
  type DamageType,
  type LegendaryAction,
  type Sense,
  type Skill,
  type SpeedKind,
  type Trait,
} from '../model';
import { abilityModifier, xpForCr } from '../rules/abilities';
import { DiceError, parseDice } from '../rules/dice';

/** A stat block line that could not be understood; `lineNumber` is 1-based, 0 when the problem is a missing line. */
export class StatBlockError extends Error {
  constructor(
    message: string,
    readonly line: string,
    readonly lineNumber: number,
  ) {
    super(lineNumber > 0 ? `${message} (line ${lineNumber}: "${line}")` : message);
    this.name = 'StatBlockError';
  }
}

interface Line {
  text: string;
  number: number;
}

type Section = 'traits' | 'actions' | 'bonusActions' | 'reactions' | 'legendary';

const SECTION_HEADERS: Record<string, Section> = {
  actions: 'actions',
  'bonus actions': 'bonusActions',
  reactions: 'reactions',
  'legendary actions': 'legendary',
};

const ABILITY_LABELS: Record<string, Ability> = {
  str: 'str',
  dex: 'dex',
  con: 'con',
  int: 'int',
  wis: 'wis',
  cha: 'cha',
};

const SAPIENT_ALIGNMENTS = ALIGNMENTS.filter((a) => a !== 'unaligned');

const ALIGNMENT_GROUPS: Record<string, Alignment[]> = {
  good: ['lawful-good', 'neutral-good', 'chaotic-good'],
  evil: ['lawful-evil', 'neutral-evil', 'chaotic-evil'],
  lawful: ['lawful-good', 'lawful-neutral', 'lawful-evil'],
  chaotic: ['chaotic-good', 'chaotic-neutral', 'chaotic-evil'],
  neutral: ['lawful-neutral', 'neutral', 'chaotic-neutral'],
};

// Aidedd page exports end with a source line and a breadcrumb.
const FOOTER = /^(Monster Manual|Source:)/i;
const BREADCRUMB = /^DnD 5e Monsters\b/i;
const GLUED_HEADER = /^(.*[.)])\s*(Actions|Bonus Actions|Reactions|Legendary Actions)$/i;
const NAME_CONNECTORS: Record<string, true> = {
  of: true,
  the: true,
  and: true,
  or: true,
  a: true,
  an: true,
  in: true,
  on: true,
  from: true,
  with: true,
  to: true,
  at: true,
  by: true,
  for: true,
};
const SPELL_LEVEL = /\s*(Cantrips \(|\d+(?:st|nd|rd|th) level \(|At will:|\d+\/day(?: each)?:)/gi;

function fail(message: string, line: Line): never {
  throw new StatBlockError(message, line.text, line.number);
}

function toLines(text: string): Line[] {
  const normalised = text.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00a0/g, ' ');
  return normalised.split(/\r?\n/).flatMap((raw, i) => {
    const line = raw.trim();
    const glued = GLUED_HEADER.exec(line);
    return glued
      ? [
          { text: glued[1]!.trim(), number: i + 1 },
          { text: glued[2]!, number: i + 1 },
        ]
      : [{ text: line, number: i + 1 }];
  });
}

/** Removes the source footer; the paragraph glued to it is the flavour text. */
function splitFooter(lines: Line[]): { body: Line[]; flavor: string; source: string } {
  const kept = lines.filter((l) => !BREADCRUMB.test(l.text));
  const footer = kept.findIndex((l) => FOOTER.test(l.text));
  let start = footer;
  while (start > 0 && kept[start - 1]!.text !== '') {
    start -= 1;
  }
  return footer === -1
    ? { body: kept, flavor: '', source: '' }
    : {
        body: kept.slice(0, start),
        flavor: kept
          .slice(start, footer)
          .map((l) => l.text)
          .join(' '),
        source: kept[footer]!.text.replace(/^Source:\s*/i, ''),
      };
}

function parseTypeLine(line: Line): Pick<Creature, 'size' | 'type' | 'subtype' | 'tags'> & { alignment: string } {
  const match = /^(\w+)\s+([^,(]+?)\s*(?:\(([^)]*)\))?\s*,\s*(.+)$/.exec(line.text);
  const size = match?.[1]!.toLowerCase() as CreatureSize;
  if (!match || !SIZES.includes(size)) {
    fail('Expected "<size> <type>, <alignment>"', line);
  }
  const typeText = match[2]!.toLowerCase();
  const swarm = /^swarm of \w+ (\w+?)(?:ies|s)?$/.exec(typeText);
  const type = (swarm ? swarm[1]!.replace(/monstrosit$/, 'monstrosity') : typeText) as CreatureTypeName;
  if (!CREATURE_TYPES.includes(type)) {
    fail(`Unknown creature type "${typeText}"`, line);
  }
  return { size, type, subtype: match[3]?.trim() ?? '', tags: swarm ? ['swarm'] : [], alignment: match[4]!.trim() };
}

function alignmentsFor(name: string, line: Line): Alignment[] {
  const exact = name.replace(/\s+/g, '-');
  const group = /^any (non-)?(good|evil|lawful|chaotic|neutral) alignment$/.exec(name);
  let result: Alignment[];
  if ((ALIGNMENTS as readonly string[]).includes(exact)) {
    result = [exact as Alignment];
  } else if (name === 'any alignment') {
    result = [...SAPIENT_ALIGNMENTS];
  } else if (group) {
    const members = ALIGNMENT_GROUPS[group[2]!]!;
    result = group[1] ? SAPIENT_ALIGNMENTS.filter((a) => !members.includes(a)) : members;
  } else {
    fail(`Unknown alignment "${name}"`, line);
  }
  return result;
}

/** Spreads each listed alternative's probability evenly over the alignments it allows. */
function parseAlignmentWeights(text: string, line: Line): Creature['alignmentWeights'] {
  const parts = text.toLowerCase().split(/\s+or\s+/);
  const weights: Creature['alignmentWeights'] = {};
  for (const part of parts) {
    const percent = /\((\d+)\s*%\)/.exec(part);
    const share = percent ? Number(percent[1]) / 100 : 1 / parts.length;
    const members = alignmentsFor(part.replace(/\([^)]*\)/g, '').trim(), line);
    for (const alignment of members) {
      weights[alignment] = (weights[alignment] ?? 0) + share / members.length;
    }
  }
  return weights;
}

function parseFormula(text: string, line: Line): string {
  let formula = '';
  try {
    formula = parseDice(text.replace(/\bplus\b/gi, '+')).expression;
  } catch (error) {
    if (!(error instanceof DiceError)) {
      throw error;
    }
    fail(error.message, line);
  }
  return formula;
}

function parseSpeeds(text: string, line: Line): Pick<Creature, 'speeds' | 'hover'> {
  const hover = /\(hover\)/i.test(text);
  const speeds: Creature['speeds'] = {};
  for (const part of text.replace(/\([^)]*\)/g, '').split(',')) {
    const match = /^(walk|burrow|climb|fly|swim)?\s*(\d+)\s*ft\.?/i.exec(part.trim());
    if (!match) {
      fail(`Unknown speed "${part.trim()}"`, line);
    }
    const kind = (match[1]?.toLowerCase() ?? 'walk') as SpeedKind;
    speeds[kind] = speeds[kind] ?? Number(match[2]);
  }
  return { speeds, hover };
}

function parseBonuses<K extends string>(text: string, line: Line, keyOf: (label: string) => K | undefined) {
  const result: Partial<Record<K, number>> = {};
  for (const match of text.matchAll(/([A-Za-z][A-Za-z ]*?)\s*([+-])\s*(\d+)/g)) {
    const key = keyOf(match[1]!.trim().toLowerCase());
    if (key === undefined) {
      fail(`Unknown entry "${match[1]!.trim()}"`, line);
    }
    result[key] = Number(match[3]) * (match[2] === '-' ? -1 : 1);
  }
  return result;
}

/** Qualified entries ("... from nonmagical attacks") stay whole; plain lists split at commas. */
function parseDamageList(text: string): string[] {
  return text
    .split(';')
    .flatMap((part) => (/\b(from|that|while|except)\b/i.test(part) ? [part] : part.split(',')))
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '' && part !== '-');
}

function parseConditions(text: string, line: Line): Creature['conditionImmunities'] {
  const lower = text.toLowerCase();
  const found = CONDITIONS.filter((c) => lower.includes(c));
  if (found.length === 0 && lower.replace(/[-\s]/g, '') !== '') {
    fail('Unknown condition', line);
  }
  return found;
}

function parseSenses(text: string, line: Line): { senses: Creature['senses']; passive: number | null } {
  const senses: Creature['senses'] = {};
  let passive: number | null = null;
  const parts = text
    .replace(/\([^)]*\)/g, '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '' && p !== '-');
  for (const part of parts) {
    const passiveMatch = /^passive perception (\d+)/i.exec(part);
    const sense = /^(blindsight|darkvision|tremorsense|truesight)\s+(\d+)/i.exec(part);
    if (passiveMatch) {
      passive = Number(passiveMatch[1]);
    } else if (sense) {
      senses[sense[1]!.toLowerCase() as Sense] = Number(sense[2]);
    } else {
      fail(`Unknown sense "${part}"`, line);
    }
  }
  return { senses, passive };
}

function parseChallenge(text: string, line: Line): { challenge: number; xp: number } {
  const match = /^(\d+)(?:\/(\d+))?\s*(?:\(\s*([\d,]+))?/.exec(text);
  if (!match) {
    fail('Expected a challenge rating', line);
  }
  const challenge = Number(match[1]) / (match[2] ? Number(match[2]) : 1);
  return { challenge, xp: match[3] ? Number(match[3].replace(/,/g, '')) : xpForCr(challenge) };
}

interface Header {
  creature: Creature;
  abilities: Partial<Record<Ability, number>>;
  passive: number | null;
  seen: Set<string>;
}

type PropertyHandler = (rest: string, line: Line, header: Header) => void;

const PROPERTIES: [RegExp, string, PropertyHandler][] = [
  [
    /^Armor Class\s+/i,
    'Armor Class',
    (rest, line, h) => {
      const match = /^(\d+)\s*(.*)$/.exec(rest);
      if (!match) {
        fail('Expected an armor class', line);
      }
      h.creature.armorClass = Number(match[1]);
      h.creature.armorNote = match[2]!.replace(/^\((.*)\)$/, '$1').trim();
    },
  ],
  [
    /^Hit Points\s+/i,
    'Hit Points',
    (rest, line, h) => {
      const match = /^(\d+)\s*(?:\(([^)]*)\))?/.exec(rest);
      if (!match) {
        fail('Expected hit points', line);
      }
      h.creature.hitPoints = { average: Number(match[1]), formula: match[2] ? parseFormula(match[2], line) : '' };
    },
  ],
  [/^Speed\s+/i, 'Speed', (rest, line, h) => Object.assign(h.creature, parseSpeeds(rest, line))],
  [
    /^Saving Throws\s+/i,
    'Saving Throws',
    (rest, line, h) => {
      h.creature.savingThrows = parseBonuses(rest, line, (label) => ABILITY_LABELS[label.slice(0, 3)]);
    },
  ],
  [
    /^Skills\s+/i,
    'Skills',
    (rest, line, h) => {
      const skill = (label: string) => SKILLS.find((s) => s === label.replace(/\s+/g, '-')) as Skill | undefined;
      h.creature.skills = parseBonuses(rest, line, skill);
    },
  ],
  [/^Damage Vulnerabilities\s*/i, '', (rest, _l, h) => (h.creature.damageVulnerabilities = parseDamageList(rest))],
  [/^Damage Resistances\s*/i, '', (rest, _l, h) => (h.creature.damageResistances = parseDamageList(rest))],
  [/^Damage Immunities\s*/i, '', (rest, _l, h) => (h.creature.damageImmunities = parseDamageList(rest))],
  [/^Condition Immunities\s*/i, '', (rest, line, h) => (h.creature.conditionImmunities = parseConditions(rest, line))],
  [
    /^Senses\s+/i,
    '',
    (rest, line, h) => {
      const { senses, passive } = parseSenses(rest, line);
      h.creature.senses = senses;
      h.passive = passive;
    },
  ],
  [
    /^Languages\s*/i,
    '',
    (rest, _l, h) => {
      h.creature.languages = rest
        .split(/,(?![^(]*\))/)
        .map((l) => l.trim())
        .filter((l) => l !== '' && l !== '-');
    },
  ],
  [/^Challenge\s+/i, 'Challenge', (rest, line, h) => Object.assign(h.creature, parseChallenge(rest, line))],
  [/^Proficiency Bonus\b/i, '', () => undefined],
];

const ABILITY_ROW = /^STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA$/i;
const ABILITY_LINE = /^(STR|DEX|CON|INT|WIS|CHA)\b\s*(\d+)?/i;

/** Ability scores as one labelled line each ("STR 27 (+8)"), label and value on two lines, or a table row. */
function readAbility(lines: Line[], i: number, header: Header): number {
  const row = ABILITY_ROW.test(lines[i]!.text);
  const single = ABILITY_LINE.exec(lines[i]!.text)!;
  const valueLine = lines[i + 1];
  let consumed = 1;
  if (row) {
    const values = (valueLine?.text.replace(/\([^)]*\)/g, '').match(/\d+/g) ?? []).map(Number);
    if (values.length !== ABILITIES.length) {
      fail('Expected six ability scores', valueLine ?? lines[i]!);
    }
    ABILITIES.forEach((ability, n) => (header.abilities[ability] = values[n]!));
    consumed = 2;
  } else if (single[2] !== undefined) {
    header.abilities[ABILITY_LABELS[single[1]!.toLowerCase()]!] = Number(single[2]);
  } else {
    const value = /^(\d+)/.exec(valueLine?.text ?? '');
    if (!value) {
      fail('Expected an ability score', valueLine ?? lines[i]!);
    }
    header.abilities[ABILITY_LABELS[single[1]!.toLowerCase()]!] = Number(value[1]);
    consumed = 2;
  }
  return consumed;
}

/** Reads property and ability lines; returns the index of the first trait/action line. */
function readHeader(lines: Line[], start: number, header: Header): number {
  let i = start;
  let reading = true;
  while (reading && i < lines.length) {
    const line = lines[i]!;
    const property = PROPERTIES.find(([pattern]) => pattern.test(line.text));
    if (property) {
      property[2](line.text.replace(property[0], '').trim(), line, header);
      header.seen.add(property[1]);
      i += 1;
    } else if (ABILITY_LINE.test(line.text)) {
      i += readAbility(lines, i, header);
    } else {
      reading = false;
    }
  }
  return i;
}

/** Title-case words with short connectors; parenthetical parts ("(Recharge 5-6)") are ignored. */
export function isNameLike(text: string): boolean {
  const words = text
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');
  return (
    text.length <= 70 &&
    words.length > 0 &&
    words.length <= 8 &&
    !/[:,;]/.test(text) &&
    words.every((w) => /^[A-Z0-9]/.test(w) || NAME_CONNECTORS[w] === true)
  );
}

/** Index of the first period outside parentheses, or -1. */
function nameEnd(text: string): number {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < text.length && found === -1; i++) {
    const c = text[i];
    depth += c === '(' ? 1 : c === ')' ? -1 : 0;
    found = c === '.' && depth === 0 ? i : -1;
  }
  return found;
}

/**
 * "Name. Description" entries. Pages without the description text list several bare names on one line
 * ("Fey Ancestry. Innate Spellcasting."); those become entries with empty descriptions.
 */
function parseEntries(text: string): Trait[] | null {
  const end = nameEnd(text);
  const name = end === -1 ? text : text.slice(0, end).trim();
  const rest = end === -1 ? '' : text.slice(end + 1).trim();
  let entries: Trait[] | null = null;
  if (isNameLike(name)) {
    const more = rest === '' ? [] : parseEntries(rest);
    const bareNames = more !== null && more.every((e) => e.description === '') && /\.$/.test(rest);
    entries = rest === '' || bareNames ? [{ name, description: '' }, ...(more ?? [])] : [{ name, description: rest }];
  }
  return entries;
}

const ATTACK_HEADER = /^(Melee (?:or|and) Ranged|Melee|Ranged) (Weapon|Spell) Attack:/i;

function parseDamage(hit: string, line: Line): DamageRoll[] {
  const damage: DamageRoll[] = [];
  const first = /^(\d+)\s*(?:\(([^)]+)\))?\s+([a-z]+)(?: or [a-z]+)?\s+damage/i;
  const next = /^\s*,?\s*plus\s+(\d+)\s*(?:\(([^)]+)\))?\s+([a-z]+)(?: or [a-z]+)?\s+damage/i;
  let rest = hit;
  let match = first.exec(rest);
  while (match && DAMAGE_TYPES.includes(match[3]!.toLowerCase() as DamageType)) {
    damage.push({
      formula: match[2] ? parseFormula(match[2], line) : match[1]!,
      type: match[3]!.toLowerCase() as DamageType,
    });
    rest = rest.slice(match[0].length);
    match = next.exec(rest);
  }
  return damage;
}

/** Attack roll of an action; only the first damage alternative before "or" counts, later riders stay in text. */
export function parseAttack(description: string, line: Line = { text: description, number: 0 }): AttackRoll | null {
  const header = ATTACK_HEADER.exec(description);
  let attack: AttackRoll | null = null;
  if (header) {
    const toHit = /([+-]\d+)\s+to hit/i.exec(description);
    if (!toHit) {
      fail('Attack without "to hit" bonus', line);
    }
    const reach = /reach (\d+)\s*ft/i.exec(description);
    const range = /range (\d+)(?:\/(\d+))?\s*ft/i.exec(description);
    const targets = /ft\.?,\s*([^.]*?)\.\s*Hit:/i.exec(description);
    const hit = /Hit:\s*([^.]*)/i.exec(description);
    const reachOrRange = header[1]!.toLowerCase();
    const kind = / (or|and) /.test(reachOrRange) ? 'melee-or-ranged' : `${reachOrRange}-${header[2]!.toLowerCase()}`;
    attack = {
      kind: kind as AttackKind,
      toHit: Number(toHit[1]),
      reachFt: reach ? Number(reach[1]) : null,
      rangeFt: range ? { normal: Number(range[1]), long: Number(range[2] ?? range[1]) } : null,
      targets: targets?.[1]!.trim() ?? '',
      damage: hit ? parseDamage(hit[1]!, line) : [],
    };
  }
  return attack;
}

interface Sections {
  traits: { entry: Trait; line: Line }[];
  actions: { entry: Trait; line: Line }[];
  bonusActions: { entry: Trait; line: Line }[];
  reactions: { entry: Trait; line: Line }[];
  legendary: { entry: Trait; line: Line }[];
  legendaryDescription: string;
}

function readSections(lines: Line[]): Sections {
  const sections: Sections = {
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendary: [],
    legendaryDescription: '',
  };
  let current: Section = 'traits';
  let last: Trait | null = null;
  for (const line of lines) {
    const header = SECTION_HEADERS[line.text.toLowerCase()];
    const entries = header ? null : parseEntries(line.text);
    const legendaryIntro = current === 'legendary' && sections.legendary.length === 0 && last === null;
    if (header) {
      current = header;
      last = null;
    } else if (legendaryIntro && (entries === null || /legendary action/i.test(line.text))) {
      sections.legendaryDescription = line.text;
    } else if (entries) {
      sections[current].push(...entries.map((entry) => ({ entry, line })));
      last = entries[entries.length - 1]!;
    } else if (last) {
      last.description = `${last.description}\n${line.text}`.trim();
    } else {
      fail('Unexpected line', line);
    }
  }
  return sections;
}

function formatSpellcasting(trait: Trait): Trait {
  return /spellcasting/i.test(trait.name)
    ? { ...trait, description: trait.description.replace(SPELL_LEVEL, '\n$1').trim() }
    : trait;
}

function toAction({ entry, line }: { entry: Trait; line: Line }): CreatureAction {
  return { ...entry, attack: parseAttack(entry.description, line) };
}

/** Splits the "(Costs N Actions)" suffix off a legendary action name. */
export function legendaryAction(entry: Trait): LegendaryAction {
  const cost = /\s*\(Costs (\d+) Actions?\)/i.exec(entry.name);
  return {
    name: cost ? entry.name.replace(cost[0], '').trim() : entry.name,
    description: entry.description,
    cost: cost ? Number(cost[1]) : 1,
  };
}

function requireHeader(header: Header, nameLine: Line): void {
  const missingProperty = ['Armor Class', 'Hit Points', 'Speed', 'Challenge'].find((p) => !header.seen.has(p));
  const missingAbility = ABILITIES.find((a) => header.abilities[a] === undefined);
  if (missingProperty) {
    throw new StatBlockError(`Missing "${missingProperty}" in "${nameLine.text}"`, '', 0);
  }
  if (missingAbility) {
    throw new StatBlockError(`Missing ability score ${missingAbility.toUpperCase()} in "${nameLine.text}"`, '', 0);
  }
}

/**
 * Parses a 5e stat block in the layout of the legacy raw files (name, optional "[ translation ]" line,
 * "<size> <type>, <alignment>", properties, abilities, traits, then Actions / Bonus Actions / Reactions /
 * Legendary Actions sections, optional source footer).
 */
export function parseStatBlock(text: string, meta: { source?: string; license?: string } = {}): Creature {
  const { body, flavor, source } = splitFooter(toLines(text));
  const lines = body.filter((l) => l.text !== '');
  const nameLine = lines[0];
  if (!nameLine) {
    throw new StatBlockError('Empty stat block', '', 0);
  }
  const typeIndex = /^\[.*\]$/.test(lines[1]?.text ?? '') ? 2 : 1;
  const typeLine = lines[typeIndex] ?? fail('Missing size/type line', nameLine);
  const { alignment, ...kind } = parseTypeLine(typeLine);
  const header: Header = { creature: createCreature(nameLine.text), abilities: {}, passive: null, seen: new Set() };
  const bodyStart = readHeader(lines, typeIndex + 1, header);
  requireHeader(header, nameLine);
  const sections = readSections(lines.slice(bodyStart));
  const creature = header.creature;
  const abilities = header.abilities as Creature['abilities'];
  return {
    ...creature,
    ...kind,
    source: meta.source ?? source,
    license: meta.license ?? '',
    alignmentText: alignment,
    alignmentWeights: parseAlignmentWeights(alignment, typeLine),
    abilities,
    passivePerception: header.passive ?? 10 + (creature.skills.perception ?? abilityModifier(abilities.wis)),
    traits: sections.traits.map(({ entry }) => formatSpellcasting(entry)),
    actions: sections.actions.map(toAction),
    bonusActions: sections.bonusActions.map(toAction),
    reactions: sections.reactions.map(({ entry }) => entry),
    legendaryDescription: sections.legendaryDescription,
    legendaryActions: sections.legendary.map(({ entry }) => legendaryAction(entry)),
    notes: flavor,
  };
}
