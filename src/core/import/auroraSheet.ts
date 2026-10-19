import {
  CHARACTER_SHEET_SCHEMA_VERSION,
  CURRENCIES,
  SPELL_STATUSES,
  type CharacterFeature,
  type CharacterSheet,
  type CharacterSpell,
  type Currency,
  type InventoryItem,
  type Spellcasting,
} from '../model';
import { childElements, descendants, firstChild, textOf, type XmlElement } from '../xml';
import { auroraDocId, type AuroraIndex } from './aurora';
import { auroraMarkdown } from './auroraMarkdown';

/**
 * The parts of an Aurora character's sheet that are text and lists in the character file (features, spells,
 * equipment, coins, personality, appearance); the numbers come from `auroraCharacter`, which evaluates the build.
 */

/** Numbers `auroraCharacter` computed from the build, plus the names it shows. */
export type AuroraSheetNumbers = Pick<
  CharacterSheet,
  'race' | 'classes' | 'background' | 'proficiencyBonus' | 'abilities' | 'savingThrows' | 'skills'
>;

const FEATURE_TYPES = ['Racial Trait', 'Class Feature', 'Archetype Feature', 'Feat', 'Background Feature'];
/** Elements whose name becomes the source of the features chosen below them. */
const ORIGIN_TYPES = ['Race', 'Sub Race', 'Class', 'Multiclass', 'Archetype', 'Background'];
const COIN_NAMES: Record<string, (typeof CURRENCIES)[number]> = {
  copper: 'cp',
  silver: 'sp',
  electrum: 'ep',
  gold: 'gp',
  platinum: 'pp',
  ...Object.fromEntries(CURRENCIES.map((c) => [c, c])),
};

function wholeNumber(text: string, fallback: number): number {
  const value = Number(text);
  return text.trim() !== '' && Number.isInteger(value) ? value : fallback;
}

/**
 * Features, racial traits and feats in build order, each once, with the race, class or background it was chosen
 * under as source (else its element type). Elements Aurora keeps off its own sheet (`<sheet display="false">`)
 * stay off.
 */
function features(tree: XmlElement, index: AuroraIndex): CharacterFeature[] {
  const seen = new Set<string>();
  const nameOf = (id: string) => index.get(id)?.attributes.name;
  const walk = (parent: XmlElement, origin: string): CharacterFeature[] =>
    childElements(parent, 'element').flatMap((element) => {
      const id = element.attributes.id || element.attributes.registered || '';
      const type = element.attributes.type ?? '';
      const known = index.get(id);
      const name = known?.attributes.name ?? element.attributes.name ?? '';
      const key = id || name;
      const hidden = firstChild(known ?? element, 'sheet')?.attributes.display === 'false';
      const shown = FEATURE_TYPES.includes(type) && name !== '' && !seen.has(key) && !hidden;
      seen.add(key);
      const own = shown
        ? [{ name, source: origin || type, text: auroraMarkdown(firstChild(known ?? element, 'description'), nameOf) }]
        : [];
      return [...own, ...walk(element, ORIGIN_TYPES.includes(type) ? name : origin)];
    });
  return walk(tree, '');
}

/** Spellcasting per class and its cantrips and spells; of the spells only the marked ones when Aurora marks any. */
function magic(build: XmlElement, index: AuroraIndex): Pick<CharacterSheet, 'spellcasting' | 'spells'> {
  const castings = childElements(firstChild(build, 'magic') ?? build, 'spellcasting');
  const spellcasting: Spellcasting[] = castings.map((c) => ({
    source: c.attributes.name ?? '',
    ability: c.attributes.ability ?? '',
    saveDc: wholeNumber(c.attributes.dc ?? '', 0),
    attackBonus: wholeNumber(c.attributes.attack ?? '', 0),
  }));
  const spells = castings.flatMap((casting) => {
    const cantrips = childElements(firstChild(casting, 'cantrips') ?? casting, 'spell');
    const all = childElements(firstChild(casting, 'spells') ?? casting, 'spell');
    const marked = all.filter((s) => SPELL_STATUSES.some((status) => s.attributes[status] === 'true'));
    const toSpell = (spell: XmlElement, level: number): CharacterSpell => {
      const id = spell.attributes.id ?? '';
      return {
        name: spell.attributes.name ?? index.get(id)?.attributes.name ?? '',
        level,
        // The strongest mark wins: always prepared, prepared, known.
        status:
          level === 0 ? 'known' : (SPELL_STATUSES.toReversed().find((s) => spell.attributes[s] === 'true') ?? 'known'),
        source: casting.attributes.name ?? '',
        spell: index.has(id) ? auroraDocId(id) : null,
      };
    };
    return [
      ...cantrips.map((s) => toSpell(s, 0)),
      ...(marked.length > 0 ? marked : all).map((s) =>
        toSpell(s, Math.min(9, Math.max(0, wholeNumber(s.attributes.level ?? '', 0)))),
      ),
    ];
  });
  return { spellcasting, spells };
}

/** Every item of the equipment with its count; a name given in Aurora's item details wins. */
function inventory(build: XmlElement, index: AuroraIndex): InventoryItem[] {
  return childElements(firstChild(build, 'equipment') ?? build, 'item').map((item) => {
    const id = item.attributes.id ?? '';
    const custom = textOf(firstChild(firstChild(item, 'details') ?? item, 'name'));
    return {
      name: custom || item.attributes.name || index.get(id)?.attributes.name || 'Item',
      item: index.has(id) ? auroraDocId(id) : null,
      quantity: Math.max(0, wholeNumber(textOf(firstChild(item, 'quantity')), 1)),
      equipped: childElements(item, 'equipped').some((e) => textOf(e) === 'true'),
      attuned: textOf(firstChild(item, 'attunement')) === 'true' || item.attributes.attuned === 'true',
    };
  });
}

function currency(build: XmlElement): Currency {
  const coins = descendants(build).find((e) => e.name === 'coins' || e.name === 'currency');
  const result: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  for (const coin of coins ? childElements(coins) : []) {
    const key = COIN_NAMES[coin.name];
    if (key) {
      result[key] = Math.max(0, wholeNumber(textOf(coin), 0));
    }
  }
  return result;
}

/** The character's sheet: the computed numbers plus what the file lists. */
export function auroraSheet(root: XmlElement, index: AuroraIndex, numbers: AuroraSheetNumbers): CharacterSheet {
  const build = firstChild(root, 'build') ?? root;
  const tree = firstChild(build, 'elements') ?? build;
  // Aurora keeps the player's texts in the build's input and appearance.
  const texts = [firstChild(build, 'input'), firstChild(build, 'appearance')].flatMap((e) => (e ? descendants(e) : []));
  const text = (...names: string[]) => textOf(texts.find((e) => names.includes(e.name)));
  return {
    schema: 'character-sheet',
    version: CHARACTER_SHEET_SCHEMA_VERSION,
    ...numbers,
    features: features(tree, index),
    ...magic(build, index),
    inventory: inventory(build, index),
    currency: currency(build),
    personality: {
      traits: text('background-traits', 'personality-traits', 'traits'),
      ideals: text('background-ideals', 'ideals'),
      bonds: text('background-bonds', 'bonds'),
      flaws: text('background-flaws', 'flaws'),
    },
    appearance: {
      age: text('age'),
      height: text('height'),
      weight: text('weight'),
      eyes: text('eyes'),
      skin: text('skin'),
      hair: text('hair'),
    },
    backstory: text('backstory'),
  };
}
