import { describe, expect, it } from 'vitest';
import { encodePng } from '@/core/png';
import { LegacyFolderError, planLegacyImport, runLegacyImport, type LegacySource } from './legacyImport';
import { MemoryStorage } from './memoryStorage';
import { Repository } from './repository';
import { childEntries, StorageError } from './storage';

const PROGRAM = 'C:/Old';
const LEGACY = `${PROGRAM}/240722_DnD_DMTool_Data`;

function legacyCreature(name: string, imagePath: string) {
  return {
    Name: name,
    ImagePath: imagePath,
    BeeingSize: 1,
    BeeingType: 9,
    Alignment: { neutralevil: 1 },
    ArmorClass: 15,
    Strength: 8,
    Dexterity: 14,
    Constitution: 10,
    Intelligence: 10,
    Wisdom: 8,
    Charisma: 8,
    SavingThrowProficencyStrength: false,
    SavingThrowProficencyDexterity: false,
    SavingThrowProficencyConstitution: false,
    SavingThrowProficencyIntelligence: false,
    SavingThrowProficencyWisdom: false,
    SavingThrowProficencyCharisma: false,
    Challenge: 0.25,
    HitPointsDiceCount: 2,
    WalkSpeed: 30,
    BurrowSpeed: 0,
    ClimbSpeed: 0,
    FlySpeed: 0,
    SwimSpeed: 0,
    Abilities: [],
    Attacks: [],
    LegendaryActionDescription: '',
    LegendaryActions: [],
    Senses: { PassivePerception: 9 },
    CharacterSkills: {},
    DamageResistances: [],
    DamageImmunities: [],
    ConditionImmunities: [],
    Languages: [0],
    AverageHitPoints: 7,
  };
}

function legacyTile(x: number, y: number) {
  return {
    BaseHeight: 1,
    WallTopHeight: 1,
    WallBottomHeight: 1,
    WallLeftHeight: 1,
    WallRightHeight: 1,
    X: x,
    Y: y,
  };
}

function legacyMarker(name: string, changeIllumination: boolean) {
  return {
    Name: name,
    PhysicalShapeType: 4,
    Width: 8,
    Length: 8,
    ChangeIllumination: changeIllumination,
    OutlineBrush: '#FFFF0000',
  };
}

const json = (value: unknown) => JSON.stringify(value);

/** The old tool's folder tree as absolute paths, the way the CLI and the app read it. */
async function legacyFiles(): Promise<Record<string, string | Uint8Array>> {
  const mapPicture = await encodePng({ width: 4, height: 2, channels: 1, bitDepth: 8, samples: new Uint16Array(8) });
  const goblin = legacyCreature('Goblin', '240722_DnD_DMTool_Data//Monsters//goblin.jpg');
  return {
    [`${PROGRAM}/240722_DnD_DMTool.exe`]: new Uint8Array([1]),
    // The legacy tool wrote a byte order mark and lowercased picture names.
    [`${LEGACY}/BeeingType/Goblin.json`]: `\uFEFF${json(goblin)}`,
    [`${LEGACY}/Monsters/Goblin.jpg`]: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    [`${LEGACY}/NPCs/Mira.json`]: json(legacyCreature('Mira', '240722_DnD_DMTool_Data\\NPCs\\mira.png')),
    [`${LEGACY}/BeeingType/Broken.json`]: json({ Name: 'Broken', Strength: 'strong' }),
    [`${LEGACY}/MapType/Cellar.json`]: json({
      Name: 'Cellar',
      MapPath: '240722_DnD_DMTool_Data\\MapType\\cellar.png',
      TilesCountInWidth: 2,
      TilesCountInLength: 1,
      Tiles: [legacyTile(0, 0), legacyTile(1, 0)],
    }),
    [`${LEGACY}/MapType/cellar.png`]: mapPicture,
    [`${LEGACY}/MapType/unused.png`]: mapPicture,
    [`${LEGACY}/MarkerType/Fireball.json`]: json(legacyMarker('Fireball', false)),
    [`${LEGACY}/MarkerType/Torch.json`]: json(legacyMarker('Torch', true)),
    [`${LEGACY}/ItemType/Sword.json`]: json({ Name: 'Sword' }),
  };
}

function memorySource(files: Record<string, string | Uint8Array>): LegacySource {
  const file = (path: string) => {
    const value = files[path.replace(/\\/g, '/')];
    if (value === undefined) {
      throw new StorageError('File not found', path);
    }
    return value;
  };
  return {
    list: async (folder) => {
      const entries = childEntries(folder.replace(/\\/g, '/').replace(/\/+$/, ''), Object.keys(files));
      if (entries.length === 0) {
        throw new StorageError('Not a folder', folder);
      }
      return entries;
    },
    readText: async (path) => {
      const value = file(path);
      return typeof value === 'string' ? value : new TextDecoder().decode(value);
    },
    readBytes: async (path) => {
      const value = file(path);
      return typeof value === 'string' ? new TextEncoder().encode(value) : value;
    },
  };
}

describe('legacy import', () => {
  it('lists what will be imported before writing', async () => {
    const plan = await planLegacyImport(memorySource(await legacyFiles()), LEGACY);
    expect(plan.creatures.map((c) => [c.file, c.doc.id])).toEqual([
      ['BeeingType/Goblin.json', 'legacy--goblin'],
      ['NPCs/Mira.json', 'legacy--mira'],
    ]);
    expect(plan.maps.map((m) => m.file)).toEqual(['MapType/Cellar.json']);
    expect(plan.markers.map((m) => m.file)).toEqual(['MarkerType/Fireball.json']);
    expect(plan.images).toBe(2);
  });

  it('writes the open data layout and reports skipped files and problems by file name', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const files = await legacyFiles();
    const source = memorySource(files);
    const progress: number[] = [];
    const report = await runLegacyImport(await planLegacyImport(source, LEGACY), source, repository, (done, total) =>
      progress.push(done / total),
    );

    expect(report.imported).toEqual({ creatures: 2, maps: 1, areaTemplates: 1 });
    expect(progress.at(-1)).toBe(1);
    expect(report.skipped.map((p) => p.file)).toEqual([
      'BeeingType/Broken.json',
      'MapType/unused.png',
      'MarkerType/Torch.json',
      'ItemType/Sword.json',
    ]);
    expect(report.skipped[0]!.message).toMatch(/Broken\.json.*not a valid legacy creature/);
    expect(report.warnings).toContainEqual({
      file: 'NPCs/Mira.json',
      message: 'image not found: 240722_DnD_DMTool_Data\\NPCs\\mira.png',
    });

    expect(storage.files.data.get('library/creatures/legacy--goblin.txt')).toMatch(/^Goblin$/m);
    expect(storage.files.data.get('library/creatures/legacy--goblin.jpg')).toEqual(
      files[`${LEGACY}/Monsters/Goblin.jpg`],
    );
    const creatures = await repository.list('creature');
    expect(creatures.entries.map((e) => [e.doc.name, e.doc.kind, e.doc.image?.path ?? null])).toEqual([
      ['Goblin', 'monster', 'library/creatures/legacy--goblin.jpg'],
      ['Mira', 'npc', null],
    ]);
    const map = await repository.load('map', { area: 'data', id: 'legacy--cellar' });
    expect(map.image).toMatchObject({
      asset: { area: 'data', path: 'library/maps/legacy--cellar/assets/cellar.png' },
      widthPx: 4,
      heightPx: 2,
    });
    const markers = await repository.list('marker');
    expect(markers.entries.map((e) => [e.doc.name, e.doc.shape, e.doc.sizeFt])).toEqual([['Fireball', 'sphere', 20]]);
  });

  it('overwrites the earlier import when run again', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const source = memorySource(await legacyFiles());
    await runLegacyImport(await planLegacyImport(source, LEGACY), source, repository);
    const written = [...storage.files.data.keys()].sort();
    const again = await runLegacyImport(await planLegacyImport(source, LEGACY), source, repository);
    expect(again.imported).toEqual({ creatures: 2, maps: 1, areaTemplates: 1 });
    expect([...storage.files.data.keys()].sort()).toEqual(written);
  });

  it('says what is missing when the folder is not the old data folder', async () => {
    const source = memorySource(await legacyFiles());
    await expect(planLegacyImport(source, PROGRAM)).rejects.toThrow(LegacyFolderError);
    await expect(planLegacyImport(source, PROGRAM)).rejects.toThrow(/contains 240722_DnD_DMTool_Data: choose that/);
    await expect(planLegacyImport(source, `${LEGACY}/MapType`)).rejects.toThrow(
      /none of the old tool's folders \(BeeingType, NPCs, Players, MapType, MarkerType\)/,
    );
  });
});
