import type { Item } from '../items';
import type { Spell } from '../spells';
import { childElements, firstChild, parseXml, textOf, type XmlElement } from '../xml';
import { auroraMarkdown } from './auroraMarkdown';
import { slug } from './ids';

/**
 * Aurora Builder element files (`custom/**\/*.xml`: `<elements>` with `<element name type source id>`, each with
 * `description`, `setters` (`<set name="…">`), `supports` and `rules`) mapped to library items and spells.
 */

/** Elements by Aurora id; a later file's element replaces an earlier one with the same id. */
export type AuroraIndex = Map<string, XmlElement>;

export const AURORA_ITEM_TYPES = ['Item', 'Weapon', 'Armor'] as const;
export const AURORA_MAGIC_ITEM = 'Magic Item';
export const AURORA_SPELL = 'Spell';

/** Adds the elements of one Aurora XML file to `index`. */
export function indexAuroraElements(index: AuroraIndex, text: string): void {
  for (const element of childElements(parseXml(text), 'element')) {
    const id = element.attributes.id;
    if (id) {
      index.set(id, element);
    }
  }
}

/** Library id of an Aurora element: its id as a slug ("ID_PHB_SPELL_AID" → "phb-spell-aid"); stable on re-import. */
export function auroraDocId(auroraId: string): string {
  return slug(auroraId.replace(/^ID_/i, ''));
}

export function auroraElementsOfType(index: AuroraIndex, types: readonly string[]): XmlElement[] {
  return [...index.values()].filter((e) => types.includes(e.attributes.type ?? ''));
}

function setters(element: XmlElement): Map<string, XmlElement> {
  const sets = childElements(firstChild(element, 'setters') ?? element, 'set');
  return new Map(sets.toReversed().map((s) => [s.attributes.name ?? '', s]));
}

/** "Very rare" → "Very Rare", so filters list each rarity once. */
function titleWords(text: string): string {
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Comma list of `supports` without Aurora ids. */
function supportsList(element: XmlElement): string[] {
  return textOf(firstChild(element, 'supports'))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('ID_'));
}

/** `ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED` style supports with `prefix`, as readable words. */
function internalSupports(element: XmlElement, prefix: string): string[] {
  return textOf(firstChild(element, 'supports'))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(prefix))
    .map((s) => s.slice(prefix.length).toLowerCase().replace(/_/g, ' '));
}

/** Weapon and armor numbers that Aurora keeps in setters, as a first description line. */
function statLine(element: XmlElement, sets: Map<string, XmlElement>): string {
  const value = (name: string) => textOf(sets.get(name));
  const damage = sets.get('damage');
  const properties = internalSupports(element, 'ID_INTERNAL_WEAPON_PROPERTY_');
  const parts = [
    damage ? `**Damage:** ${textOf(damage)} ${damage.attributes.type ?? ''}`.trim() : '',
    value('range') && `**Range:** ${value('range')} ft.`,
    properties.length > 0 ? `**Properties:** ${properties.join(', ')}` : '',
    value('armorClass') && `**Armor Class:** ${value('armorClass')}`,
    value('strength') && `**Strength:** ${value('strength')}`,
    value('stealth') && `**Stealth:** ${value('stealth')}`,
  ];
  return parts.filter((p) => p !== '').join('. ');
}

function itemType(element: XmlElement, sets: Map<string, XmlElement>): string {
  const typeSet = sets.get('type');
  const addition = typeSet?.attributes.addition;
  const kind = element.attributes.type;
  const weaponCategory = internalSupports(element, 'ID_INTERNAL_WEAPON_CATEGORY_')[0];
  const armorGroup = internalSupports(element, 'ID_INTERNAL_ARMOR_GROUP_')[0];
  let type = textOf(sets.get('category'));
  if (kind === AURORA_MAGIC_ITEM && textOf(typeSet) !== '') {
    type = addition ? `${textOf(typeSet)} (${addition})` : textOf(typeSet);
  } else if (kind === 'Weapon' && weaponCategory) {
    type = `Weapon (${weaponCategory})`;
  } else if (kind === 'Armor' && armorGroup) {
    type = `Armor (${armorGroup})`;
  }
  return type;
}

function costText(set: XmlElement | undefined): string {
  const amount = textOf(set);
  return amount === '' || Number(amount) === 0 ? '' : `${amount} ${set!.attributes.currency ?? 'gp'}`;
}

export function auroraItem(element: XmlElement, index: AuroraIndex): Item {
  const sets = setters(element);
  const attunement = sets.get('attunement');
  const description = auroraMarkdown(firstChild(element, 'description'), (id) => index.get(id)?.attributes.name);
  return {
    id: auroraDocId(element.attributes.id ?? ''),
    name: element.attributes.name ?? '',
    type: itemType(element, sets),
    rarity: titleWords(textOf(sets.get('rarity'))),
    attunement: textOf(attunement) === 'true' ? (attunement!.attributes.addition ?? 'yes') : '',
    cost: costText(sets.get('cost')),
    weight: textOf(sets.get('weight')),
    source: element.attributes.source ?? '',
    createdAt: null,
    updatedAt: null,
    description: [statLine(element, sets), description].filter((p) => p !== '').join('\n\n'),
  };
}

export function auroraSpell(element: XmlElement, index: AuroraIndex): Spell {
  const sets = setters(element);
  const value = (name: string) => textOf(sets.get(name));
  const material = value('materialComponent');
  const components = [
    value('hasVerbalComponent') === 'true' ? 'V' : '',
    value('hasSomaticComponent') === 'true' ? 'S' : '',
    value('hasMaterialComponent') === 'true' ? (material === '' ? 'M' : `M (${material})`) : '',
  ];
  const level = Number(value('level'));
  return {
    id: auroraDocId(element.attributes.id ?? ''),
    name: element.attributes.name ?? '',
    level: Number.isInteger(level) && level >= 0 && level <= 9 ? level : 0,
    school: value('school'),
    castingTime: value('time'),
    range: value('range'),
    components: components.filter((c) => c !== '').join(', '),
    duration: value('duration'),
    ritual: value('isRitual') === 'true',
    classes: supportsList(element),
    source: element.attributes.source ?? '',
    createdAt: null,
    updatedAt: null,
    description: auroraMarkdown(firstChild(element, 'description'), (id) => index.get(id)?.attributes.name),
  };
}
