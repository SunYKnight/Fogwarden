import { describe, expect, it } from 'vitest';
import { formatItemFile, parseItemFile } from '../items';
import { formatSpellFile, parseSpellFile } from '../spells';
import { parseXml } from '../xml';
import {
  AURORA_ITEM_TYPES,
  AURORA_MAGIC_ITEM,
  auroraElementsOfType,
  auroraItem,
  auroraSpell,
  indexAuroraElements,
  type AuroraIndex,
} from './aurora';
import { auroraMarkdown } from './auroraMarkdown';

const ELEMENTS = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <info><name>Test Book</name></info>
  <!-- a comment -->
  <element name="Rope" type="Item" source="Test Book" id="ID_TEST_ITEM_ROPE">
    <description><p>Fifty feet &amp; sturdy.</p></description>
    <setters>
      <set name="category">Adventuring Gear</set>
      <set name="cost" currency="gp">1</set>
      <set name="weight" lb="10">10 lb.</set>
    </setters>
  </element>
  <element name="Club" type="Weapon" source="Test Book" id="ID_TEST_WEAPON_CLUB">
    <supports>ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE, ID_INTERNAL_WEAPON_PROPERTY_LIGHT</supports>
    <description><p></p></description>
    <setters>
      <set name="category">Weapons</set>
      <set name="cost" currency="sp">1</set>
      <set name="damage" type="bludgeoning">1d4</set>
    </setters>
  </element>
  <element name="Wand of Sparks" type="Magic Item" source="Test Book" id="ID_TEST_MAGIC_ITEM_WAND_OF_SPARKS">
    <description>
      <p>This wand has 3 charges.</p>
      <p class="indent"><b><i>Spark.</i></b> While holding it, you can use an action.<br/>It sparks.</p>
      <div class="reference"><div element="ID_TEST_ITEM_ROPE" /></div>
    </description>
    <setters>
      <set name="type">Wand</set>
      <set name="rarity">Very rare</set>
      <set name="attunement" addition="by a spellcaster">true</set>
      <set name="cost" currency="gp">0</set>
    </setters>
  </element>
  <element name="Spark Bolt" type="Spell" source="Test Book" id="ID_TEST_SPELL_SPARK_BOLT">
    <supports>Sorcerer, Wizard, ID_INTERNAL_SOMETHING</supports>
    <description>
      <p>A bolt of sparks.</p>
      <h5>Spark Table</h5>
      <table>
        <thead><tr><td>d6</td><td>Effect</td></tr></thead>
        <tr><td>1-3</td><td><em>Fizzle</em></td></tr>
        <tr><td>4-6</td><td>Boom | crack</td></tr>
      </table>
      <ul><li>First</li><li><strong>Second</strong> line</li></ul>
    </description>
    <setters>
      <set name="level">2</set>
      <set name="school">Evocation</set>
      <set name="time">1 action</set>
      <set name="duration">Concentration, up to 1 minute</set>
      <set name="range">60 feet</set>
      <set name="hasVerbalComponent">true</set>
      <set name="hasSomaticComponent">false</set>
      <set name="hasMaterialComponent">true</set>
      <set name="materialComponent">a pinch of copper</set>
      <set name="isConcentration">true</set>
      <set name="isRitual">true</set>
    </setters>
  </element>
</elements>`;

function index(): AuroraIndex {
  const elements: AuroraIndex = new Map();
  indexAuroraElements(elements, ELEMENTS);
  return elements;
}

describe('Aurora items and spells', () => {
  it('maps items, weapons and magic items with cost, weight, rarity and attunement', () => {
    const elements = index();
    const items = auroraElementsOfType(elements, AURORA_ITEM_TYPES).map((e) => auroraItem(e, elements));
    expect(items).toMatchObject([
      {
        id: 'test-item-rope',
        name: 'Rope',
        type: 'Adventuring Gear',
        rarity: '',
        cost: '1 gp',
        weight: '10 lb.',
        source: 'Test Book',
        description: 'Fifty feet & sturdy.',
      },
      {
        id: 'test-weapon-club',
        type: 'Weapon (simple melee)',
        cost: '1 sp',
        description: '**Damage:** 1d4 bludgeoning. **Properties:** light',
      },
    ]);
    const [wand] = auroraElementsOfType(elements, [AURORA_MAGIC_ITEM]).map((e) => auroraItem(e, elements));
    expect(wand).toMatchObject({
      id: 'test-magic-item-wand-of-sparks',
      type: 'Wand',
      rarity: 'Very Rare',
      attunement: 'by a spellcaster',
      cost: '',
    });
    expect(wand!.description).toBe(
      'This wand has 3 charges.\n\n**_Spark._** While holding it, you can use an action. It sparks.\n\nSee _Rope_.',
    );
  });

  it('maps spells and converts headings, tables and lists to Markdown', () => {
    const elements = index();
    const spell = auroraSpell(elements.get('ID_TEST_SPELL_SPARK_BOLT')!, elements);
    expect(spell).toMatchObject({
      id: 'test-spell-spark-bolt',
      level: 2,
      school: 'Evocation',
      castingTime: '1 action',
      range: '60 feet',
      components: 'V, M (a pinch of copper)',
      duration: 'Concentration, up to 1 minute',
      ritual: true,
      classes: ['Sorcerer', 'Wizard'],
    });
    expect(spell.description).toBe(
      [
        'A bolt of sparks.',
        '##### Spark Table',
        '| d6 | Effect |\n| --- | --- |\n| 1-3 | _Fizzle_ |\n| 4-6 | Boom / crack |',
        '- First\n- **Second** line',
      ].join('\n\n'),
    );
  });

  it('writes items and spells as files that read back the same', () => {
    const elements = index();
    const at = { createdAt: '2026-10-12T10:00:00.000Z', updatedAt: '2026-10-12T11:00:00.000Z' };
    const wand = { ...auroraItem(elements.get('ID_TEST_MAGIC_ITEM_WAND_OF_SPARKS')!, elements), ...at };
    const spell = { ...auroraSpell(elements.get('ID_TEST_SPELL_SPARK_BOLT')!, elements), ...at };
    const itemText = formatItemFile(wand);
    expect(itemText).toContain(
      '---\nname: Wand of Sparks\ntype: Wand\nrarity: Very Rare\nattunement: by a spellcaster\n',
    );
    expect(parseItemFile(itemText, wand.id)).toEqual(wand);
    const spellText = formatSpellFile(spell);
    expect(spellText).toContain('level: 2\nschool: Evocation\ncastingTime: 1 action\n');
    expect(parseSpellFile(spellText, spell.id)).toEqual(spell);
    expect(() => parseSpellFile('---\nlevel: 12\n---\n', 'x')).toThrow('Line 2');
  });

  it('keeps text of unknown wrappers and ignores empty paragraphs', () => {
    const description = parseXml(
      '<description><p></p><div class="sidebar"><p>Note <i>this</i>.</p></div></description>',
    );
    expect(auroraMarkdown(description, () => undefined)).toBe('> Note _this_.');
  });
});
