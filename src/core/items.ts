import { formatFrontMatter, parseFrontMatter, readTimestamp } from './frontMatter';

/**
 * Items (`items/<id>.md`): a header (`name`, `type`, `rarity`, `attunement`, `cost`, `weight`, `source`, time
 * stamps), then the description as Markdown. Mundane items have no rarity; `attunement` is empty, `yes` or the
 * condition ("by a spellcaster").
 */

const HEADER_KEYS = [
  'name',
  'type',
  'rarity',
  'attunement',
  'cost',
  'weight',
  'source',
  'createdAt',
  'updatedAt',
] as const;

export interface Item {
  id: string;
  name: string;
  /** "Weapon (longsword)", "Wondrous item", "Adventuring Gear" … */
  type: string;
  /** "Uncommon", "Very Rare" …; empty for mundane items. */
  rarity: string;
  attunement: string;
  cost: string;
  weight: string;
  source: string;
  createdAt: string | null;
  updatedAt: string | null;
  description: string;
}

export function parseItemFile(text: string, id: string): Item {
  const header = parseFrontMatter(text, HEADER_KEYS);
  const value = (key: (typeof HEADER_KEYS)[number]) => header.values[key] ?? '';
  return {
    id,
    name: value('name') || id,
    type: value('type'),
    rarity: value('rarity'),
    attunement: value('attunement'),
    cost: value('cost'),
    weight: value('weight'),
    source: value('source'),
    createdAt: readTimestamp(header, 'createdAt'),
    updatedAt: readTimestamp(header, 'updatedAt'),
    description: header.body,
  };
}

export function formatItemFile(item: Item): string {
  const header: [string, string][] = [
    ['name', item.name],
    ['type', item.type],
    ['rarity', item.rarity],
    ['attunement', item.attunement],
    ['cost', item.cost],
    ['weight', item.weight],
    ['source', item.source],
    ['createdAt', item.createdAt ?? ''],
    ['updatedAt', item.updatedAt ?? ''],
  ];
  return formatFrontMatter(header, item.description);
}

/** One line under the name: type, rarity and attunement as in the books. */
export function itemSubtitle(item: Item): string {
  const attunement =
    item.attunement === ''
      ? ''
      : item.attunement === 'yes'
        ? 'requires attunement'
        : `requires attunement ${item.attunement}`;
  const rarity = [item.rarity.toLowerCase(), attunement && `(${attunement})`].filter((p) => p !== '').join(' ');
  return [item.type, rarity].filter((p) => p !== '').join(', ');
}
