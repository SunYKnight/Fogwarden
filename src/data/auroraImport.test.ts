import { describe, expect, it } from 'vitest';
import { AURORA_PACK, planAuroraImport, runAuroraImport, type AuroraSource } from './auroraImport';
import { MemoryStorage } from './memoryStorage';
import { Repository } from './repository';
import { childEntries } from './storage';

const FOLDER = 'C:/Users/me/Documents/5e Character Builder';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function elementsFile(withLantern: boolean): string {
  const lantern = `<element name="Lantern" type="Item" source="T" id="ID_T_ITEM_LANTERN">
      <description><p>Light.</p></description><setters><set name="category">Adventuring Gear</set></setters>
    </element>`;
  return `<elements>
    <element name="Fighter" type="Class" source="T" id="ID_T_CLASS_FIGHTER"><setters><set name="hd">d10</set></setters></element>
    <element name="Rope" type="Item" source="T" id="ID_T_ITEM_ROPE">
      <description><p>Rope.</p></description><setters><set name="category">Adventuring Gear</set></setters>
    </element>
    ${withLantern ? lantern : ''}
    <element name="Ring of Luck" type="Magic Item" source="T" id="ID_T_MAGIC_ITEM_RING">
      <description><p>Lucky.</p></description><setters><set name="type">Ring</set><set name="rarity">Rare</set></setters>
    </element>
    <element name="Zap" type="Spell" source="T" id="ID_T_SPELL_ZAP">
      <supports>Wizard</supports><description><p>Zap.</p></description>
      <setters><set name="level">0</set><set name="school">Evocation</set></setters>
    </element>
  </elements>`;
}

function characterFile(level: number, portrait: string): string {
  return `<character>
    <display-properties><name>Selana</name><class>Fighter</class><level>${level}</level>
      <portrait><local>${FOLDER.replace(/\//g, '\\')}\\portraits\\${portrait}</local><base64>iVBORw==</base64></portrait>
    </display-properties>
    <build>
      <abilities><strength>16</strength><dexterity>10</dexterity><constitution>14</constitution>
        <intelligence>10</intelligence><wisdom>10</wisdom><charisma>10</charisma></abilities>
      <elements>
        <element type="Option" id="ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP" />
        <element type="Level" name="1" id="ID_LEVEL_1"><element type="Class" registered="ID_T_CLASS_FIGHTER" /></element>
      </elements>
    </build>
  </character>`;
}

/** An Aurora folder held in memory, addressed by absolute paths like the desktop's folder access. */
function auroraFolder(files: Map<string, string | Uint8Array>): AuroraSource {
  const read = (path: string) => {
    const file = files.get(path);
    if (file === undefined) {
      throw new Error(`missing ${path}`);
    }
    return file;
  };
  return {
    list: async (path) => childEntries(path, files.keys()),
    readText: async (path) => read(path) as string,
    readBytes: async (path) => read(path) as Uint8Array,
  };
}

function firstImport(): Map<string, string | Uint8Array> {
  return new Map<string, string | Uint8Array>([
    [`${FOLDER}/custom/core/test.xml`, elementsFile(true)],
    [`${FOLDER}/custom/core.index`, '<index />'],
    [`${FOLDER}/custom/user/broken.xml`, '<elements><element></elements>'],
    [`${FOLDER}/Selana.dnd5e`, characterFile(1, 'selana.png')],
    [`${FOLDER}/portraits/selana.png`, PNG],
    [`${FOLDER}/portraits/elf (druid).jpg`, new Uint8Array([0xff, 0xd8])],
    [`${FOLDER}/portraits/notes.txt`, 'not a picture'],
  ]);
}

const PACK = `packs/${AURORA_PACK.id}`;

describe('Aurora Builder import', () => {
  it('previews counts and imports everything into the pack "Aurora Builder"', async () => {
    const source = auroraFolder(firstImport());
    const plan = await planAuroraImport(source, FOLDER);
    expect([plan.items.length, plan.magicItems.length, plan.spells.length, plan.characters.length]).toEqual([
      2, 1, 1, 1,
    ]);
    expect(plan.portraits).toEqual(['elf (druid).jpg', 'selana.png']);
    expect(plan.problems).toEqual([
      { file: 'custom/user/broken.xml', message: 'Unexpected </elements> at character 19' },
    ]);

    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const progress: number[] = [];
    const report = await runAuroraImport(plan, source, repository, (done) => progress.push(done));
    expect(report).toEqual({ characters: 1, items: 2, magicItems: 1, spells: 1, portraits: 2, removed: 0 });
    expect(progress.at(-1)).toBe(2 + 3 + 1 + 1);

    const files = storage.files.data;
    expect(JSON.parse(files.get(`${PACK}/pack.json`) as string)).toMatchObject({
      name: 'Aurora Builder',
      license: 'see source books',
    });
    expect(files.get(`${PACK}/items/t-item-rope.md`)).toContain('name: Rope\ntype: Adventuring Gear\n');
    expect(files.get(`${PACK}/spells/t-spell-zap.md`)).toContain('level: 0\nschool: Evocation\n');
    expect(files.get(`${PACK}/portraits/elf _druid_.jpg`)).toEqual(new Uint8Array([0xff, 0xd8]));
    expect(files.get(`${PACK}/creatures/selana.png`)).toEqual(PNG);
    const { entries } = await repository.list('creature');
    expect(entries.map((e) => [e.doc.name, e.doc.kind, e.doc.level, e.doc.hitPoints.average, e.pack])).toEqual([
      ['Selana', 'player', 1, 12, AURORA_PACK.id],
    ]);
    expect((await repository.listPortraits()).map((p) => p.name)).toEqual(['elf _druid_.jpg', 'selana.png']);
  });

  it('replaces the earlier import: level-ups arrive, removed elements and portraits go', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const first = auroraFolder(firstImport());
    await runAuroraImport(await planAuroraImport(first, FOLDER), first, repository, () => undefined);

    const files = firstImport();
    files.set(`${FOLDER}/custom/core/test.xml`, elementsFile(false));
    files.set(`${FOLDER}/Selana.dnd5e`, characterFile(2, 'selana.png'));
    files.delete(`${FOLDER}/portraits/selana.png`);
    files.delete(`${FOLDER}/portraits/elf (druid).jpg`);
    const second = auroraFolder(files);
    const report = await runAuroraImport(await planAuroraImport(second, FOLDER), second, repository, () => undefined);

    expect(report.removed).toBe(2);
    const data = storage.files.data;
    expect(data.has(`${PACK}/items/t-item-lantern.md`)).toBe(false);
    expect(data.has(`${PACK}/portraits/elf _druid_.jpg`)).toBe(false);
    // Without the portrait file the picture embedded in the character file is used.
    expect(data.get(`${PACK}/portraits/selana.png`)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(data.get(`${PACK}/creatures/selana.png`)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const { entries } = await repository.list('creature');
    expect(entries.map((e) => [e.doc.level, e.doc.hitPoints.average])).toEqual([[2, 12 + 8]]);
    expect((await repository.list('item')).entries.map((e) => e.doc.name)).toEqual(['Ring of Luck', 'Rope']);
  });

  it('refuses folders without Aurora Builder data', async () => {
    const source = auroraFolder(new Map([[`${FOLDER}/readme.txt`, 'hi']]));
    await expect(planAuroraImport(source, FOLDER)).rejects.toThrow('holds no Aurora Builder data');
  });
});
