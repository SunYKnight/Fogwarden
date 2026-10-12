import { FileFormatError, formatFrontMatter, parseFrontMatter, readTimestamp, splitList } from './frontMatter';

/**
 * Spells (`spells/<id>.md`): a header (`name`, `level` 0 for cantrips, `school`, `castingTime`, `range`,
 * `components`, `duration`, `ritual` yes/no, `classes` comma list, `source`, time stamps), then the description
 * as Markdown.
 */

const HEADER_KEYS = [
  'name',
  'level',
  'school',
  'castingTime',
  'range',
  'components',
  'duration',
  'ritual',
  'classes',
  'source',
  'createdAt',
  'updatedAt',
] as const;

export interface Spell {
  id: string;
  name: string;
  /** 0 for cantrips, else 1 to 9. */
  level: number;
  school: string;
  castingTime: string;
  range: string;
  /** "V, S, M (a pinch of salt)". */
  components: string;
  duration: string;
  ritual: boolean;
  classes: string[];
  source: string;
  createdAt: string | null;
  updatedAt: string | null;
  description: string;
}

const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

export function parseSpellFile(text: string, id: string): Spell {
  const header = parseFrontMatter(text, HEADER_KEYS);
  const value = (key: (typeof HEADER_KEYS)[number]) => header.values[key] ?? '';
  const level = Number(value('level') || '0');
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new FileFormatError('"level" must be a whole number from 0 (cantrip) to 9', header.lines.level!);
  }
  const ritual = value('ritual').toLowerCase();
  if (!['', 'yes', 'no'].includes(ritual)) {
    throw new FileFormatError('"ritual" must be yes or no', header.lines.ritual!);
  }
  return {
    id,
    name: value('name') || id,
    level,
    school: value('school'),
    castingTime: value('castingTime'),
    range: value('range'),
    components: value('components'),
    duration: value('duration'),
    ritual: ritual === 'yes',
    classes: splitList(header.values.classes),
    source: value('source'),
    createdAt: readTimestamp(header, 'createdAt'),
    updatedAt: readTimestamp(header, 'updatedAt'),
    description: header.body,
  };
}

export function formatSpellFile(spell: Spell): string {
  const header: [string, string][] = [
    ['name', spell.name],
    ['level', String(spell.level)],
    ['school', spell.school],
    ['castingTime', spell.castingTime],
    ['range', spell.range],
    ['components', spell.components],
    ['duration', spell.duration],
    ['ritual', spell.ritual ? 'yes' : 'no'],
    ['classes', spell.classes.join(', ')],
    ['source', spell.source],
    ['createdAt', spell.createdAt ?? ''],
    ['updatedAt', spell.updatedAt ?? ''],
  ];
  return formatFrontMatter(header, spell.description);
}

/** "Evocation cantrip", "3rd-level necromancy (ritual)". */
export function spellSubtitle(spell: Spell): string {
  const school = spell.school.toLowerCase();
  const base =
    spell.level === 0 ? `${spell.school} cantrip` : `${ORDINALS[spell.level] ?? `${spell.level}th`}-level ${school}`;
  return spell.ritual ? `${base} (ritual)` : base;
}
