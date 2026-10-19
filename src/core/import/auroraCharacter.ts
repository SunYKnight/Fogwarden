import { base64ToBytes } from '../binary';
import {
  ABILITIES,
  ALIGNMENTS,
  createCreature,
  DAMAGE_TYPES,
  SIZES,
  SKILL_ABILITY,
  SKILLS,
  type Ability,
  type AttackRoll,
  type CharacterSheet,
  type Creature,
  type CreatureAction,
  type DamageType,
  type Senses,
  type Skill,
} from '../model';
import { abilityModifier } from '../rules/abilities';
import { childElements, descendants, firstChild, parseXml, textOf, type XmlElement } from '../xml';
import type { AuroraIndex } from './aurora';
import { auroraSheet } from './auroraSheet';
import { slug } from './ids';

/**
 * Aurora Builder characters (`.dnd5e`) as player character creatures. The file holds the build (chosen
 * elements, base ability scores, equipment) but no computed sheet values, so this evaluates the `<stat>` rules
 * of the chosen elements from the element files like Aurora does: summed per stat name, the highest of each
 * `bonus` group, `level`, `requirements` and `equipped` conditions. Aurora's built-in elements (ability score
 * improvements, proficiencies, vision, base armor class) are not in the element files and are applied here.
 */

export interface AuroraCharacter {
  creature: Creature;
  /** The full sheet, stored beside the creature. */
  sheet: CharacterSheet;
  /** File name of the portrait in Aurora's `portraits/` folder, from the character's portrait path. */
  portraitFile: string | null;
  /** The portrait Aurora embeds in the character file (PNG), used when the folder lacks the file. */
  portraitPng: Uint8Array | null;
}

const ABILITY_NAMES: Record<Ability, string> = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
};
const ABILITY_BY_SHORT: Record<string, string> = Object.fromEntries(ABILITIES.map((a) => [a, ABILITY_NAMES[a]]));
/** Aurora's built-in vision elements (not in the element files) and their ranges in feet. */
const VISION: Record<string, [keyof Senses, number]> = {
  ID_VISION_DARKVISION: ['darkvision', 60],
  ID_VISION_SUPERIORDARKVISION: ['darkvision', 120],
};
const OTHER_SPEEDS = ['fly', 'climb', 'swim', 'burrow'] as const;
const SLOT_ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
const ITEM_TYPES = ['Item', 'Weapon', 'Armor', 'Magic Item'];

interface StatRule {
  name: string;
  value: string;
  bonus: string;
  level: number;
  requirements: string;
  equipped: string;
}

interface Build {
  /** Ids of every chosen element, with repeats (two ability score improvements of the same score). */
  ids: string[];
  idSet: Set<string>;
  level: number;
  /** Lower-case class names, for `level:<class>`. */
  classes: string[];
  baseScores: Record<string, number>;
  rules: Map<string, StatRule[]>;
  armorGroup: 'light' | 'medium' | 'heavy' | null;
  shield: boolean;
}

function numberOr(text: string | undefined, fallback: number): number {
  const value = Number(text);
  return text !== undefined && text.trim() !== '' && Number.isFinite(value) ? value : fallback;
}

function statRules(element: XmlElement | undefined): StatRule[] {
  const rules = element ? childElements(firstChild(element, 'rules') ?? element, 'stat') : [];
  return rules.map((s) => ({
    name: (s.attributes.name ?? '').toLowerCase(),
    value: (s.attributes.value ?? '').toLowerCase(),
    bonus: s.attributes.bonus ?? '',
    level: numberOr(s.attributes.level, 1),
    requirements: s.attributes.requirements ?? '',
    equipped: s.attributes.equipped ?? '',
  }));
}

/**
 * Aurora condition expressions: `,` is and, `||` or, `!` not, parentheses group, atoms are element ids or
 * bracketed checks that `atom` decides.
 */
function evaluateCondition(expression: string, atom: (text: string) => boolean): boolean {
  const tokens = expression.match(/\|\||[(),!]|\[[^\]]*\]|[^\s(),!|[\]]+/g) ?? [];
  let at = 0;
  const parseOr = (): boolean => {
    let result = parseAnd();
    while (tokens[at] === '||') {
      at += 1;
      result = parseAnd() || result;
    }
    return result;
  };
  const parseAnd = (): boolean => {
    let result = parseUnary();
    while (tokens[at] === ',') {
      at += 1;
      result = parseUnary() && result;
    }
    return result;
  };
  const parseUnary = (): boolean => {
    const token = tokens[at];
    at += 1;
    let result = false;
    if (token === '!') {
      result = !parseUnary();
    } else if (token === '(') {
      result = parseOr();
      at += 1;
    } else if (token !== undefined) {
      result = atom(token);
    }
    return result;
  };
  return expression.trim() === '' || parseOr();
}

class StatSheet {
  private readonly cache = new Map<string, number>();
  private readonly evaluating = new Set<string>();

  constructor(private readonly build: Build) {}

  get proficiency(): number {
    return 2 + Math.floor((this.build.level - 1) / 4);
  }

  private applies(rule: StatRule): boolean {
    const { build } = this;
    const requirement = (atom: string) => {
      const check = /^\[(.+):(-?\d+)\]$/.exec(atom);
      const stat = check ? (ABILITY_BY_SHORT[check[1]!] ?? check[1]!) : '';
      return check ? this.value(stat) >= Number(check[2]) : build.idSet.has(atom);
    };
    const equipped = (atom: string) => {
      const [slot, what] = atom
        .replace(/^\[|\]$/g, '')
        .toLowerCase()
        .split(':');
      let result = false;
      if (slot === 'armor') {
        result =
          what === 'none'
            ? build.armorGroup === null
            : what === 'any'
              ? build.armorGroup !== null
              : build.armorGroup === what;
      } else if (slot === 'shield') {
        result = what === 'none' ? !build.shield : build.shield;
      }
      return result;
    };
    return (
      rule.level <= build.level &&
      evaluateCondition(rule.requirements, requirement) &&
      evaluateCondition(rule.equipped, equipped)
    );
  }

  private ruleValue(rule: StatRule): number {
    return /^-?\d+(\.\d+)?$/.test(rule.value) ? Number(rule.value) : this.value(rule.value);
  }

  /** Values per `bonus` group: rules without a bonus add up, a named group counts its highest value. */
  groups(name: string): Map<string, number> {
    const groups = new Map<string, number>();
    const rules = (this.build.rules.get(name) ?? []).filter((r) => this.applies(r));
    rules.forEach((rule, i) => {
      const key = rule.bonus === '' ? `#${i}` : rule.bonus;
      const value = this.ruleValue(rule);
      groups.set(key, rule.bonus === '' ? value : Math.max(groups.get(key) ?? -Infinity, value));
    });
    return groups;
  }

  sum(name: string, without = ''): number {
    let total = 0;
    for (const [key, value] of this.groups(name)) {
      total += key === without ? 0 : value;
    }
    return total;
  }

  /** Base score plus improvements and bonuses, up to 20 or the raised maximum (never above 30). */
  private score(ability: string): number {
    const improvements = this.build.ids.filter((id) => id === `ID_INTERNAL_ASI_${ability.toUpperCase()}`).length;
    const raised = (this.build.baseScores[ability] ?? 10) + improvements + this.sum(ability);
    const max = Math.max(20, this.groups(`${ability}:max`).get('base') ?? 0) + this.sum(`${ability}:max`, 'base');
    return Math.max(1, Math.min(max, raised, 30));
  }

  walkSpeed(): number {
    const base = Math.max(this.sum('innate speed'), this.groups('speed').get('base') ?? 0);
    return base + this.sum('innate speed:misc') + this.sum('speed:misc') + this.sum('speed', 'base');
  }

  /** A stat by name: Aurora's built-ins, else the sum of its rules. */
  value(name: string): number {
    let result = this.cache.get(name);
    if (result === undefined) {
      if (this.evaluating.has(name)) {
        throw new Error(`Aurora stat "${name}" depends on itself`);
      }
      this.evaluating.add(name);
      result = this.compute(name);
      this.evaluating.delete(name);
      this.cache.set(name, result);
    }
    return result;
  }

  private compute(name: string): number {
    const [head, tail, ...rest] = name.split(':');
    const abilities = Object.values(ABILITY_NAMES);
    let result: number;
    if (name === 'level') {
      result = this.build.level;
    } else if (head === 'level' && tail !== undefined) {
      result = this.build.classes.includes(tail) ? this.build.level : 0;
    } else if (name === 'proficiency') {
      result = this.proficiency;
    } else if (name === 'speed') {
      result = this.walkSpeed();
    } else if (abilities.includes(head!) && tail === 'modifier' && rest.length === 0) {
      result = abilityModifier(this.value(head!));
    } else if (abilities.includes(name)) {
      result = this.score(name);
    } else {
      result = this.sum(name);
    }
    return result;
  }
}

/** Ids of the chosen elements in the build tree, in document order. */
function chosenIds(tree: XmlElement): string[] {
  return descendants(tree)
    .filter((e) => e.name === 'element')
    .map((e) => e.attributes.id || e.attributes.registered || '')
    .filter((id) => id.startsWith('ID_'));
}

function equippedItems(build: XmlElement): XmlElement[] {
  return childElements(firstChild(build, 'equipment') ?? build, 'item').filter((item) =>
    childElements(item, 'equipped').some((e) => textOf(e) === 'true'),
  );
}

function armorGroupOf(element: XmlElement): Build['armorGroup'] {
  const group = /ID_INTERNAL_ARMOR_GROUP_(LIGHT|MEDIUM|HEAVY)/.exec(textOf(firstChild(element, 'supports')));
  const set = childElements(firstChild(element, 'setters') ?? element, 'set').find(
    (s) => s.attributes.name === 'armor',
  );
  const named = /^(light|medium|heavy)$/i.exec(textOf(set));
  const found = (group?.[1] ?? named?.[1])?.toLowerCase();
  return found === 'light' || found === 'medium' || found === 'heavy' ? found : null;
}

function readBuild(root: XmlElement, index: AuroraIndex): Build {
  const build = firstChild(root, 'build') ?? root;
  const tree = firstChild(build, 'elements') ?? build;
  const ids = chosenIds(tree);
  const items = equippedItems(build)
    .map((i) => index.get(i.attributes.id ?? ''))
    .filter((d): d is XmlElement => d !== undefined);
  const armor = items.map(armorGroupOf).find((g) => g !== null) ?? null;
  const shield = items.some((d) => statRules(d).some((r) => r.name === 'ac:shield'));
  const rules = new Map<string, StatRule[]>();
  // Items count only while equipped, however the build lists them.
  const sources = [...new Set(ids)]
    .map((id) => index.get(id))
    .filter((d): d is XmlElement => d !== undefined && !ITEM_TYPES.includes(d.attributes.type ?? ''));
  for (const rule of [...sources, ...new Set(items)].flatMap(statRules)) {
    rules.set(rule.name, [...(rules.get(rule.name) ?? []), rule]);
  }
  const classIds = descendants(tree)
    .filter((e) => e.name === 'element' && (e.attributes.type === 'Class' || e.attributes.type === 'Multiclass'))
    .map((e) => e.attributes.registered ?? '');
  const scores = childElements(firstChild(build, 'abilities') ?? build);
  return {
    ids,
    idSet: new Set(ids),
    level: Math.max(1, numberOr(textOf(firstChild(firstChild(root, 'display-properties') ?? root, 'level')), 1)),
    classes: classIds.map((id) => (index.get(id)?.attributes.name ?? '').toLowerCase()).filter((n) => n !== ''),
    baseScores: Object.fromEntries(scores.map((s) => [s.name, numberOr(textOf(s), 10)])),
    rules,
    armorGroup: armor,
    shield,
  };
}

function armorClass(sheet: StatSheet, build: Build): number {
  const dex = sheet.value('dexterity:modifier');
  let base = 10 + dex;
  if (build.armorGroup) {
    const dexPart = { light: dex, medium: Math.min(dex, sheet.sum('ac:armored:dexterity:cap') || 2), heavy: 0 };
    base = sheet.sum('ac:armored:armor') + dexPart[build.armorGroup] + sheet.sum('ac:armored:enhancement');
  }
  const calculated = Math.max(base, ...sheet.groups('ac:calculation').values());
  return calculated + sheet.sum('ac:shield') + sheet.sum('ac:misc');
}

/** Hit points: the first level's die in full, then average (Aurora option) or Aurora's stored rolls. */
function hitPoints(sheet: StatSheet, build: Build, root: XmlElement, index: AuroraIndex): number {
  const tree = firstChild(firstChild(root, 'build') ?? root, 'elements') ?? root;
  const levels = childElements(tree, 'element').filter((e) => e.attributes.type === 'Level');
  const rolls = (levels[0]?.attributes.rndhp ?? '').split(',').map((r) => Number(r));
  const average = build.idSet.has('ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP');
  let die = 8;
  let total = 0;
  for (let level = 1; level <= build.level; level++) {
    const classElement = childElements(levels[level - 1] ?? tree, 'element').find((e) =>
      ['Class', 'Multiclass'].includes(e.attributes.type ?? ''),
    );
    const hd = childElements(
      firstChild(index.get(classElement?.attributes.registered ?? '') ?? tree, 'setters') ?? tree,
    ).find((s) => s.attributes.name === 'hd');
    die = hd ? numberOr(textOf(hd).replace(/^d/i, ''), die) : die;
    const roll = rolls[level - 1];
    total += level === 1 ? die : average || roll === undefined || !Number.isFinite(roll) ? die / 2 + 1 : roll;
  }
  return Math.max(1, total + build.level * sheet.value('constitution:modifier') + sheet.sum('hp'));
}

function skillKey(skill: Skill): string {
  return skill.replace(/-/g, '').toUpperCase();
}

function attackAction(attack: XmlElement): CreatureAction {
  const { name = 'Attack', range = '', damage = '' } = attack.attributes;
  const toHit = numberOr(/[+-]\d+/.exec(attack.attributes.attack ?? '')?.[0], 0);
  const ranged = /\d+\s*\/\s*\d+/.exec(range);
  const reach = /(\d+)\s*ft/.exec(range);
  const rolls = [...damage.matchAll(/([\dd+\- ]+?)\s+([a-z]+)/gi)]
    .map((m) => ({ formula: m[1]!.replace(/\s+/g, ''), type: m[2]!.toLowerCase() }))
    .filter(
      (d): d is { formula: string; type: DamageType } => d.formula !== '' && DAMAGE_TYPES.some((t) => t === d.type),
    );
  const [normal, long] = ranged ? ranged[0].split('/').map((n) => Number(n.trim())) : [0, 0];
  const thrown = ranged !== null && /\bthrown\b/i.test(textOf(firstChild(attack, 'description')));
  const roll: AttackRoll = {
    kind: thrown ? 'melee-or-ranged' : ranged ? 'ranged-weapon' : 'melee-weapon',
    toHit,
    reachFt: ranged && !thrown ? null : reach && !ranged ? Number(reach[1]) : 5,
    rangeFt: ranged ? { normal: normal!, long: long! } : null,
    targets: 'one target',
    damage: rolls,
  };
  const rangeText = `range ${normal}/${long} ft.`;
  const where = thrown ? `reach 5 ft. or ${rangeText}` : ranged ? rangeText : `reach ${roll.reachFt} ft.`;
  const kindText = thrown ? 'Melee or Ranged Weapon Attack' : ranged ? 'Ranged Weapon Attack' : 'Melee Weapon Attack';
  const sign = toHit >= 0 ? '+' : '';
  return {
    name,
    description: `${kindText}: ${sign}${toHit} to hit, ${where}, one target. Hit: ${damage} damage.`,
    attack: rolls.length > 0 ? roll : null,
  };
}

/** "1st", "2nd", "11th" … */
function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Spellcasting as a trait in the stat block wording `creatureResources` reads slots from. */
function spellcastingTraits(root: XmlElement, name: string, level: number) {
  const magic = firstChild(firstChild(root, 'build') ?? root, 'magic');
  return childElements(magic ?? root, 'spellcasting').map((casting) => {
    const { ability = '', dc = '', attack = '' } = casting.attributes;
    const slots = firstChild(casting, 'slots')?.attributes ?? {};
    const cantrips = childElements(firstChild(casting, 'cantrips') ?? casting, 'spell').map((s) => s.attributes.name);
    const all = childElements(firstChild(casting, 'spells') ?? casting, 'spell');
    const marked = all.filter((s) => ['prepared', 'always-prepared', 'known'].some((a) => s.attributes[a] === 'true'));
    const spells = marked.length > 0 ? marked : all;
    const lines = [
      `${name} is a ${ordinal(level)}-level spellcaster. Its spellcasting ability is ` +
        `${ability} (spell save DC ${dc}, +${attack} to hit with spell attacks).`,
      cantrips.length > 0 ? `Cantrips (at will): ${cantrips.join(', ').toLowerCase()}` : '',
      ...SLOT_ORDINALS.map((slotLevel, i) => {
        const count = numberOr(slots[`s${i + 1}`], 0);
        const names = spells.filter((s) => s.attributes.level === String(i + 1)).map((s) => s.attributes.name);
        return count > 0 ? `${slotLevel} level (${count} slots): ${names.join(', ').toLowerCase()}` : '';
      }),
    ];
    const description = lines.filter((l) => l !== '').join('\n');
    return { name: `Spellcasting (${casting.attributes.name ?? 'Spells'})`, description };
  });
}

function elementOfType(tree: XmlElement, type: string): XmlElement | undefined {
  return descendants(tree).find((e) => e.name === 'element' && e.attributes.type === type && e.attributes.registered);
}

/** File name part of a Windows or POSIX path. */
function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
}

/** Library id of a character: its file name as a slug ("Varis_6.dnd5e" → "varis-6"); stable on re-import. */
export function auroraCharacterId(fileName: string): string {
  return slug(baseName(fileName).replace(/\.dnd5e$/i, '')) || 'character';
}

export function auroraCharacter(text: string, fileName: string, index: AuroraIndex): AuroraCharacter {
  const root = parseXml(text);
  if (root.name !== 'character') {
    throw new Error(`${fileName} is no Aurora Builder character (root element <${root.name}>)`);
  }
  const display = firstChild(root, 'display-properties') ?? root;
  const tree = firstChild(firstChild(root, 'build') ?? root, 'elements') ?? root;
  const build = readBuild(root, index);
  const sheet = new StatSheet(build);
  const name = textOf(firstChild(display, 'name')) || auroraCharacterId(fileName);
  const abilities = Object.fromEntries(ABILITIES.map((a) => [a, sheet.value(ABILITY_NAMES[a])])) as Record<
    Ability,
    number
  >;
  const saves = Object.fromEntries(
    ABILITIES.map((a) => {
      const proficient = build.idSet.has(`ID_PROFICIENCY_SAVINGTHROW_${ABILITY_NAMES[a].toUpperCase()}`);
      const bonus =
        abilityModifier(abilities[a]) +
        (proficient ? sheet.proficiency : 0) +
        sheet.sum(`${ABILITY_NAMES[a]}:save:misc`);
      return [a, { proficient, bonus }];
    }),
  ) as CharacterSheet['savingThrows'];
  const savingThrows = Object.fromEntries(ABILITIES.filter((a) => saves[a].proficient).map((a) => [a, saves[a].bonus]));
  const checks = Object.fromEntries(
    SKILLS.map((skill) => {
      const proficient = build.idSet.has(`ID_PROFICIENCY_SKILL_${skillKey(skill)}`);
      const expert = proficient && build.idSet.has(`ID_EXPERTISE_SKILL_${skillKey(skill)}`);
      const bonus =
        abilityModifier(abilities[SKILL_ABILITY[skill]]) + (proficient ? 1 : 0) * (expert ? 2 : 1) * sheet.proficiency;
      return [skill, { proficiency: expert ? 'expertise' : proficient ? 'proficient' : 'none', bonus }];
    }),
  ) as CharacterSheet['skills'];
  const skills = Object.fromEntries(
    SKILLS.filter((s) => checks[s].proficiency !== 'none').map((s) => [s, checks[s].bonus]),
  );
  const senses: Senses = {};
  for (const id of build.idSet) {
    const vision = VISION[id];
    if (vision) {
      senses[vision[0]] = Math.max(senses[vision[0]] ?? 0, vision[1]);
    }
  }
  if (senses.darkvision !== undefined || sheet.sum('darkvision:range') > 0) {
    senses.darkvision = (senses.darkvision ?? 0) + sheet.sum('darkvision:range');
  }
  const speeds: Creature['speeds'] = { walk: sheet.walkSpeed() };
  for (const kind of OTHER_SPEEDS) {
    const base = Math.max(sheet.sum(`innate speed:${kind}`), sheet.sum(`speed:${kind}`));
    if (base > 0) {
      speeds[kind] = base + sheet.sum(`innate speed:${kind}:misc`);
    }
  }
  const sizeName = (elementOfType(tree, 'Size') ?? descendants(tree).find((e) => e.attributes.type === 'Size'))
    ?.attributes.name;
  const size = SIZES.find((s) => s === sizeName?.toLowerCase()) ?? 'medium';
  const subRace = elementOfType(tree, 'Sub Race');
  const race = index.get(subRace?.attributes.registered ?? '')?.attributes.name ?? textOf(firstChild(display, 'race'));
  const alignmentId = elementOfType(tree, 'Alignment')?.attributes.registered ?? '';
  const alignment = alignmentId
    .replace(/^ID_ALIGNMENT_/, '')
    .toLowerCase()
    .replace(/_/g, '-');
  const known = ALIGNMENTS.find((a) => a === alignment);
  const className = textOf(firstChild(display, 'class'));
  const archetype = textOf(firstChild(display, 'archetype'));
  const background = textOf(firstChild(display, 'background'));
  const maxHp = hitPoints(sheet, build, root, index);
  const languages = descendants(tree)
    .filter((e) => e.name === 'element' && e.attributes.type === 'Language')
    .map((e) => index.get(e.attributes.registered ?? '')?.attributes.name ?? e.attributes.name ?? '')
    .filter((n) => n !== '' && !n.includes('('));
  const attacks = childElements(
    firstChild(firstChild(firstChild(root, 'build') ?? root, 'input') ?? root, 'attacks') ?? root,
    'attack',
  );
  const portraitPath = textOf(firstChild(firstChild(display, 'portrait') ?? display, 'local'));
  const embedded = textOf(firstChild(firstChild(display, 'portrait') ?? display, 'base64'));
  const summary = `Level ${build.level} ${race} ${className}${archetype ? ` (${archetype})` : ''}`;
  const creature: Creature = {
    ...createCreature(name),
    id: auroraCharacterId(fileName),
    kind: 'player',
    level: Math.min(20, build.level),
    source: 'Aurora Builder',
    license: 'see source books',
    tags: ['aurora', slug(className)].filter((t) => t !== ''),
    size,
    type: 'humanoid',
    subtype: race.toLowerCase(),
    alignmentText: known ? known.replace(/-/g, ' ') : 'unaligned',
    alignmentWeights: known ? { [known]: 1 } : { unaligned: 1 },
    armorClass: armorClass(sheet, build),
    hitPoints: { average: maxHp, formula: '' },
    speeds,
    abilities,
    savingThrows,
    skills,
    senses,
    passivePerception: 10 + checks.perception.bonus + sheet.sum('perception:passive'),
    languages,
    traits: spellcastingTraits(root, name, build.level),
    actions: attacks.map(attackAction),
    notes: [`${summary}.`, background && `Background: ${background}.`, `From ${baseName(fileName)}.`]
      .filter((l) => l !== '')
      .join(' '),
  };
  return {
    creature,
    sheet: auroraSheet(root, index, {
      race,
      classes: `${className}${archetype ? ` (${archetype})` : ''}`,
      background,
      proficiencyBonus: sheet.proficiency,
      abilities,
      savingThrows: saves,
      skills: checks,
    }),
    portraitFile: portraitPath === '' ? null : baseName(portraitPath),
    portraitPng: embedded === '' ? null : base64ToBytes(embedded.replace(/\s+/g, '')),
  };
}
