import { describe, expect, it } from 'vitest';
import { creatureResources } from '../rules/resources';
import { indexAuroraElements, type AuroraIndex } from './aurora';
import { auroraCharacter } from './auroraCharacter';

const ELEMENTS = `<elements>
  <element name="Elf" type="Race" source="Test" id="ID_TEST_RACE_ELF">
    <rules>
      <stat name="dexterity" value="2" />
      <stat name="innate speed" value="30" bonus="base" />
      <stat name="dexterity" value="5" requirements="ID_TEST_NOT_CHOSEN" />
    </rules>
  </element>
  <element name="Wood Elf" type="Sub Race" source="Test" id="ID_TEST_SUB_RACE_WOOD_ELF">
    <rules><stat name="wisdom" value="1" /></rules>
  </element>
  <element name="Fleet of Foot" type="Racial Trait" source="Test" id="ID_TEST_FLEET">
    <rules><stat name="innate speed" value="35" bonus="base" /></rules>
  </element>
  <element name="Ranger" type="Class" source="Test" id="ID_TEST_CLASS_RANGER">
    <setters><set name="hd">d10</set></setters>
  </element>
  <element name="Defense" type="Class Feature" source="Test" id="ID_TEST_DEFENSE">
    <description><p>While you are wearing armor, you gain a <b>+1 bonus</b> to AC.</p></description>
    <rules><stat name="ac:misc" value="1" bonus="fighting style" equipped="[armor:any]" /></rules>
  </element>
  <element name="Tough Feet" type="Feat" source="Test" id="ID_TEST_TOUGH">
    <rules><stat name="hp" value="level" /><stat name="hp" value="5" level="5" /></rules>
  </element>
  <element name="Leather" type="Armor" source="Test" id="ID_TEST_ARMOR_LEATHER">
    <supports>ID_INTERNAL_ARMOR_GROUP_LIGHT</supports>
    <rules><stat name="ac:armored:armor" value="11" /></rules>
  </element>
  <element name="Shield" type="Armor" source="Test" id="ID_TEST_SHIELD">
    <rules><stat name="ac:shield" value="2" bonus="shield" /></rules>
  </element>
  <element name="Common" type="Language" source="Test" id="ID_TEST_LANGUAGE_COMMON" />
  <element name="Trance" type="Racial Trait" source="Test" id="ID_TEST_TRANCE">
    <description><p>Elves don't sleep.</p></description><sheet display="false" />
  </element>
  <element name="Hunter's Mark" type="Spell" source="Test" id="ID_TEST_SPELL_HUNTERS_MARK">
    <setters><set name="level">1</set></setters>
  </element>
</elements>`;

function character(level: number, average = true): string {
  const levels = Array.from(
    { length: level - 1 },
    (_, i) => `<element type="Level" name="${i + 2}" id="ID_LEVEL_${i + 2}" />`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<character version="1.0.3">
  <display-properties>
    <name>Awen</name><race>Elf</race><class>Ranger</class><archetype>Hunter</archetype>
    <background>Outlander</background><level>${level}</level>
    <portrait>
      <local>C:\\Users\\me\\Documents\\5e Character Builder\\portraits\\elf ranger.png</local>
      <base64><![CDATA[iVBORw0K]]></base64>
    </portrait>
  </display-properties>
  <build>
    <input>
      <attacks>
        <attack name="Longbow" range="150/600" attack="+7 vs AC" damage="1d8+4 piercing"><description><![CDATA[Ammunition]]></description></attack>
        <attack name="Dagger" range="20/60" attack="+7 vs AC" damage="1d4+4 piercing"><description><![CDATA[Finesse, Light, Thrown]]></description></attack>
      </attacks>
      <background-traits>I watch the treeline.</background-traits>
      <background-ideals>Freedom.</background-ideals>
      <backstory>Raised by wolves.</backstory>
    </input>
    <appearance><age>120</age><eyes>Green</eyes></appearance>
    <abilities><strength>10</strength><dexterity>15</dexterity><constitution>14</constitution>
      <intelligence>10</intelligence><wisdom>13</wisdom><charisma>8</charisma></abilities>
    <elements>
      ${average ? '<element type="Option" name="Average Hit Points" id="ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP" />' : ''}
      <element type="Level" name="1" id="ID_LEVEL_1" rndhp="10,3,9,1,1">
        <element type="Race" name="Race" registered="ID_TEST_RACE_ELF">
          <element type="Size" name="Medium" id="ID_SIZE_MEDIUM" />
          <element type="Vision" name="Darkvision" id="ID_VISION_DARKVISION" />
          <element type="Racial Trait" name="Fleet of Foot" id="ID_TEST_FLEET" />
          <element type="Racial Trait" name="Trance" id="ID_TEST_TRANCE" />
          <element type="Sub Race" name="Elven Subrace" registered="ID_TEST_SUB_RACE_WOOD_ELF" />
          <element type="Language" name="Common" id="ID_TEST_LANGUAGE_COMMON" />
        </element>
        <element type="Class" name="Class" registered="ID_TEST_CLASS_RANGER">
          <element type="Proficiency" name="Saving Throw Proficiency (Dexterity)" id="ID_PROFICIENCY_SAVINGTHROW_DEXTERITY" />
          <element type="Proficiency" name="Skill Proficiency (Perception)" id="ID_PROFICIENCY_SKILL_PERCEPTION" />
          <element type="Proficiency" name="Skill Proficiency (Stealth)" id="ID_PROFICIENCY_SKILL_STEALTH" />
          <element type="Class Feature" name="Fighting Style" id="ID_TEST_DEFENSE" />
          <element type="Ability Score Improvement" name="ASI" registered="ID_INTERNAL_ASI_DEXTERITY" />
          <element type="Ability Score Improvement" name="ASI" registered="ID_INTERNAL_ASI_DEXTERITY" />
        </element>
        <element type="Feat" name="Feat" registered="ID_TEST_TOUGH" />
        <element type="Alignment" name="Alignment" registered="ID_ALIGNMENT_CHAOTIC_GOOD" />
      </element>
      ${levels.join('\n')}
    </elements>
    <equipment>
      <item name="Leather" id="ID_TEST_ARMOR_LEATHER"><equipped location="Armor">true</equipped></item>
      <item name="Shield" id="ID_TEST_SHIELD"><details /></item>
      <item name="Arrows" id="ID_TEST_ARROWS"><quantity>20</quantity></item>
      <coins><gold>15</gold><silver>3</silver></coins>
    </equipment>
    <magic>
      <spellcasting name="Ranger" ability="Wisdom" attack="5" dc="13">
        <slots s1="3" s2="0" />
        <spells>
          <spell name="Hunter's Mark" level="1" id="ID_TEST_SPELL_HUNTERS_MARK" known="true" />
          <spell name="Cure Wounds" level="1" id="ID_Z" prepared="true" />
          <spell name="Alarm" level="1" id="ID_Y" />
        </spells>
      </spellcasting>
    </magic>
  </build>
</character>`;
}

function elements(): AuroraIndex {
  const index: AuroraIndex = new Map();
  indexAuroraElements(index, ELEMENTS);
  return index;
}

describe('Aurora characters', () => {
  it('computes the sheet from the build and the element rules', () => {
    const { creature, portraitFile, portraitPng } = auroraCharacter(character(3), 'Awen_3.dnd5e', elements());
    expect(creature).toMatchObject({
      id: 'awen-3',
      name: 'Awen',
      kind: 'player',
      level: 3,
      license: 'see source books',
      size: 'medium',
      subtype: 'wood elf',
      alignmentText: 'chaotic good',
      // 15 + 2 (race) + 2 (two improvements); 13 + 1 (subrace)
      abilities: { str: 10, dex: 19, con: 14, int: 10, wis: 14, cha: 8 },
      // Leather 11 + Dex 4 + Defense 1; the shield is not equipped
      armorClass: 16,
      // d10: 10 + 2 × 6 (average), Con +2 per level, Tough Feet +1 per level (its +5 needs level 5)
      hitPoints: { average: 10 + 12 + 6 + 3, formula: '' },
      speeds: { walk: 35 },
      savingThrows: { dex: 6 },
      skills: { perception: 4, stealth: 6 },
      passivePerception: 14,
      senses: { darkvision: 60 },
      languages: ['Common'],
    });
    expect(creature.notes).toBe('Level 3 Wood Elf Ranger (Hunter). Background: Outlander. From Awen_3.dnd5e.');
    expect(portraitFile).toBe('elf ranger.png');
    expect([...portraitPng!]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  });

  it('turns attacks into actions and spellcasting into slots', () => {
    const { creature } = auroraCharacter(character(3), 'Awen_3.dnd5e', elements());
    expect(creature.actions.map((a) => a.attack)).toEqual([
      {
        kind: 'ranged-weapon',
        toHit: 7,
        reachFt: null,
        rangeFt: { normal: 150, long: 600 },
        targets: 'one target',
        damage: [{ formula: '1d8+4', type: 'piercing' }],
      },
      {
        kind: 'melee-or-ranged',
        toHit: 7,
        reachFt: 5,
        rangeFt: { normal: 20, long: 60 },
        targets: 'one target',
        damage: [{ formula: '1d4+4', type: 'piercing' }],
      },
    ]);
    expect(creature.traits[0]!.description).toContain("1st level (3 slots): hunter's mark");
    expect(creature.traits[0]!.description).not.toContain('alarm');
    expect(creatureResources(creature).slots).toEqual({ 1: 3 });
  });

  it('uses the stored hit point rolls without the average option and follows level-ups', () => {
    const rolled = auroraCharacter(character(3, false), 'Awen.dnd5e', elements()).creature;
    // 10, then the rolls for levels 2 and 3 (3 and 9), Con and Tough Feet as before
    expect(rolled.hitPoints.average).toBe(10 + 3 + 9 + 6 + 3);
    const levelFive = auroraCharacter(character(5), 'Awen.dnd5e', elements()).creature;
    expect(levelFive.level).toBe(5);
    expect(levelFive.hitPoints.average).toBe(10 + 4 * 6 + 10 + 5 + 5);
  });

  it('fills the full sheet: saves, skills, features, spells, equipment and the player texts', () => {
    const { sheet } = auroraCharacter(character(3), 'Awen_3.dnd5e', elements());
    expect(sheet).toMatchObject({
      race: 'Wood Elf',
      classes: 'Ranger (Hunter)',
      background: 'Outlander',
      proficiencyBonus: 2,
      abilities: { dex: 19, wis: 14 },
      savingThrows: { dex: { proficient: true, bonus: 6 }, wis: { proficient: false, bonus: 2 } },
      skills: {
        stealth: { proficiency: 'proficient', bonus: 6 },
        perception: { proficiency: 'proficient', bonus: 4 },
        acrobatics: { proficiency: 'none', bonus: 4 },
      },
      spellcasting: [{ source: 'Ranger', ability: 'Wisdom', saveDc: 13, attackBonus: 5 }],
      currency: { cp: 0, sp: 3, ep: 0, gp: 15, pp: 0 },
      personality: { traits: 'I watch the treeline.', ideals: 'Freedom.', bonds: '', flaws: '' },
      appearance: { age: '120', height: '', eyes: 'Green' },
      backstory: 'Raised by wolves.',
    });
    // Trance stays off the sheet like in Aurora; features name what they came with.
    expect(sheet.features).toEqual([
      { name: 'Fleet of Foot', source: 'Elf', text: '' },
      { name: 'Defense', source: 'Ranger', text: 'While you are wearing armor, you gain a **+1 bonus** to AC.' },
      { name: 'Tough Feet', source: 'Feat', text: '' },
    ]);
    // Only the marked spells; a spell the element files hold gets its library id.
    expect(sheet.spells).toEqual([
      { name: "Hunter's Mark", level: 1, status: 'known', source: 'Ranger', spell: 'test-spell-hunters-mark' },
      { name: 'Cure Wounds', level: 1, status: 'prepared', source: 'Ranger', spell: null },
    ]);
    expect(sheet.inventory).toEqual([
      { name: 'Leather', item: 'test-armor-leather', quantity: 1, equipped: true, attuned: false },
      { name: 'Shield', item: 'test-shield', quantity: 1, equipped: false, attuned: false },
      { name: 'Arrows', item: null, quantity: 20, equipped: false, attuned: false },
    ]);
  });

  it('refuses files that are no characters', () => {
    expect(() => auroraCharacter('<elements />', 'x.dnd5e', elements())).toThrow('no Aurora Builder character');
  });
});
