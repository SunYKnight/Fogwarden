import { describe, expect, it } from 'vitest';
import { creatureSchema, mapSchema, markerTemplateSchema } from '../model';
import { HeightField } from '../terrain/heightfield';
import {
  convertLegacyCreature,
  convertLegacyMap,
  convertLegacyMarker,
  legacyCreatureSchema,
  legacyMapSchema,
  legacyMarkerSchema,
  type LegacyMap,
} from './legacy';

type Walls = Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>;

/** Legacy tile JSON; wall heights default to the base height (no wall). */
function tile(x: number, y: number, base: number, walls: Walls = {}): LegacyMap['Tiles'][number] {
  return {
    BaseHeight: base,
    WallTopHeight: walls.top ?? base,
    WallBottomHeight: walls.bottom ?? base,
    WallLeftHeight: walls.left ?? base,
    WallRightHeight: walls.right ?? base,
    X: x,
    Y: y,
    Ilumination: [{ Light: 0, Level: 0 }],
    Marking: [],
    PossibleMovementSpeed: [0],
  };
}

function legacyMap(width: number, length: number, tiles: LegacyMap['Tiles']): LegacyMap {
  const byKey = new Map(tiles.map((t) => [`${t.X},${t.Y}`, t]));
  const all = Array.from({ length: width * length }, (_, i) => {
    const x = Math.floor(i / length);
    const y = i % length;
    return byKey.get(`${x},${y}`) ?? tile(x, y, 1);
  });
  return legacyMapSchema.parse({
    Name: 'Tiny Map',
    MapPath: '240722_DnD_DMTool_Data\\Maps\\tiny.jpg',
    TilesCountInWidth: width,
    TilesCountInLength: length,
    Tiles: all,
  });
}

/** Wall points in a direction independent order. */
const sortedPoints = (points: { x: number; y: number }[]) => points.map((p) => `${p.x},${p.y}`).sort();

describe('convertLegacyMap', () => {
  it('turns tile base heights into terrain that keeps raised tiles flat', () => {
    const { doc, warnings } = convertLegacyMap(legacyMap(2, 1, [tile(1, 0, 3)]), null);
    expect(warnings).toEqual([]);
    const field = HeightField.fromMap(mapSchema.parse(doc));
    expect([field.cols, field.rows]).toEqual([9, 5]);
    expect(field.sample(2.5, 2.5)).toBe(0);
    expect(field.sample(3.75, 2.5)).toBe(0);
    expect(field.sample(5, 2.5)).toBe(10);
    expect(field.sample(7.5, 5)).toBe(10);
    expect(doc.walls).toEqual([]);
  });

  it('merges edge walls into polylines split at junctions and straightens runs', () => {
    const map = legacyMap(3, 2, [
      tile(0, 0, 1, { left: 3, top: 2 }),
      tile(0, 1, 1, { bottom: 3 }),
      tile(1, 0, 1, { top: 3 }),
      tile(2, 0, 1, { top: 3 }),
    ]);
    const { doc } = convertLegacyMap(map, null);
    mapSchema.parse(doc);
    expect(doc.walls.map((w) => [sortedPoints(w.points), w.closed, w.heightFt, w.baseFt])).toEqual(
      expect.arrayContaining([
        [['5,0', '5,5'], false, 10, 0],
        [['0,5', '5,5'], false, 10, 0],
        [['15,5', '5,5'], false, 10, 0],
      ]),
    );
    expect(doc.walls).toHaveLength(3);
    expect(new Set(doc.walls.map((w) => w.id)).size).toBe(3);
  });

  it('closes a wall around a single tile and lifts it onto a raised base', () => {
    const { doc } = convertLegacyMap(legacyMap(1, 1, [tile(0, 0, 2, { top: 4, bottom: 4, left: 4, right: 4 })]), null);
    expect(doc.walls).toHaveLength(1);
    expect(doc.walls[0]).toMatchObject({ closed: true, baseFt: 5, heightFt: 10 });
    expect(doc.walls[0]!.points).toHaveLength(4);
  });

  it('scales the image to the tile grid and warns about stretched images', () => {
    const image = { asset: { area: 'data' as const, path: 'x.jpg' }, widthPx: 1000, heightPx: 400 };
    const { doc, warnings } = convertLegacyMap(legacyMap(5, 4, []), image);
    expect(doc.grid).toMatchObject({ squaresX: 5, squaresY: 4, pxPerSquare: 200 });
    expect(doc.image).toEqual(image);
    expect(warnings).toEqual([expect.stringContaining('recalibrate')]);
  });
});

const legacyGoblin = {
  Name: 'Goblin',
  ImagePath: '',
  BeeingSize: 1,
  BeeingType: 9,
  Alignment: { neutralevil: 1.0, lawfulgood: 0.0 },
  ArmorClass: 15,
  Strength: 8,
  Dexterity: 14,
  Constitution: 10,
  Intelligence: 10,
  Wisdom: 8,
  Charisma: 8,
  SavingThrowProficencyStrength: false,
  SavingThrowProficencyDexterity: true,
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
  Abilities: [{ Key: 'Nimble Escape', Value: 'The goblin can take the Disengage or Hide action as a bonus action.' }],
  Attacks: [
    {
      Name: 'Scimitar',
      Description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.',
      Reach: 5,
      AtkType: 1,
      NumberOfTargets: 1,
      DmgDice: '1d6',
      DmgType: 11,
      AttrModBonusValue: 2,
      ProfModBonusValue: 2,
    },
    {
      Name: 'Knife',
      Description: 'A quick stab.',
      Reach: 5,
      AtkType: 1,
      NumberOfTargets: 1,
      DmgDice: '1d4',
      DmgType: 7,
      AttrModBonusValue: 2,
      ProfModBonusValue: 2,
    },
    {
      Name: 'Goblins are small, black-hearted humanoids',
      Description: 'They gather in large numbers.',
      Reach: 5,
      AtkType: 0,
      NumberOfTargets: 1,
      DmgDice: '1d4',
      DmgType: 1,
      AttrModBonusValue: 0,
      ProfModBonusValue: 2,
    },
    {
      Name: 'Monster Manual (SRD)',
      Description: 'DnD 5e Monsters › Goblin',
      Reach: 5,
      AtkType: 0,
      NumberOfTargets: 1,
      DmgDice: '1d4',
      DmgType: 1,
      AttrModBonusValue: 0,
      ProfModBonusValue: 2,
    },
  ],
  LegendaryActionDescription: '',
  LegendaryActions: [],
  Senses: { PassivePerception: 9, Darkvision: 60 },
  CharacterSkills: { Stealth: 6, SleightOfHand: 4 },
  DamageResistances: [],
  DamageImmunities: [3],
  ConditionImmunities: [14],
  Languages: [0, 5],
  AverageHitPoints: 7,
};

describe('convertLegacyCreature', () => {
  it('maps legacy enums and numbers onto the creature schema', () => {
    const { doc, warnings } = convertLegacyCreature(legacyCreatureSchema.parse(legacyGoblin), 'monster');
    creatureSchema.parse(doc);
    expect(warnings).toEqual([]);
    expect(doc).toMatchObject({
      id: 'legacy--goblin',
      size: 'small',
      type: 'humanoid',
      alignmentText: 'neutral evil',
      alignmentWeights: { 'neutral-evil': 1 },
      hitPoints: { average: 7, formula: '2d6' },
      savingThrows: { dex: 4 },
      skills: { stealth: 6, 'sleight-of-hand': 4 },
      damageImmunities: ['fire'],
      conditionImmunities: ['exhaustion'],
      senses: { darkvision: 60 },
      passivePerception: 9,
      languages: ['Common', 'Goblin'],
      xp: 50,
    });
  });

  it('drops the page footer the legacy parser stored as actions and keeps it as notes', () => {
    const { doc } = convertLegacyCreature(legacyCreatureSchema.parse(legacyGoblin), 'monster');
    expect(doc.actions.map((a) => a.name)).toEqual(['Scimitar', 'Knife']);
    expect(doc.notes).toBe('Goblins are small, black-hearted humanoids. They gather in large numbers.');
    expect(doc.actions[0]!.attack).toMatchObject({ toHit: 4, damage: [{ formula: '1d6+2', type: 'slashing' }] });
    expect(doc.actions[1]!.attack).toEqual({
      kind: 'melee-weapon',
      toHit: 4,
      reachFt: 5,
      rangeFt: null,
      targets: 'one target',
      damage: [{ formula: '1d4+2', type: 'piercing' }],
    });
  });

  it('replaces the empty ability scores of legacy players and reports it', () => {
    const player = { ...legacyGoblin, Name: 'Player 1', Strength: 0, Dexterity: 0, Attacks: [], HitPointsDiceCount: 0 };
    const { doc, warnings } = convertLegacyCreature(legacyCreatureSchema.parse(player), 'player');
    creatureSchema.parse(doc);
    expect(doc).toMatchObject({ kind: 'player', abilities: { str: 10, dex: 10, con: 10 }, hitPoints: { formula: '' } });
    expect(warnings).toEqual([expect.stringContaining('set to 10')]);
  });
});

describe('convertLegacyMarker', () => {
  const marker = (shape: number, width: number, length: number, extra = {}) =>
    convertLegacyMarker(
      legacyMarkerSchema.parse({
        Name: `m${shape}`,
        PhysicalShapeType: shape,
        Width: width,
        Length: length,
        ChangeIllumination: false,
        OutlineBrush: '#FFFF0000',
        ...extra,
      }),
    );

  it('converts tile sizes into 5e area dimensions', () => {
    expect(markerTemplateSchema.parse(marker(4, 8, 8))).toMatchObject({
      shape: 'sphere',
      sizeFt: 20,
      color: '#ff0000',
    });
    expect(marker(0, 12, 12)).toMatchObject({ shape: 'cone', sizeFt: 60 });
    expect(marker(1, 3, 3)).toMatchObject({ shape: 'cube', sizeFt: 15 });
    expect(marker(2, 4, 8)).toMatchObject({ shape: 'cylinder', sizeFt: 10, heightFt: 40 });
    expect(marker(3, 10, 10)).toMatchObject({ shape: 'line', sizeFt: 50, widthFt: 5 });
    expect(marker(4, 8, 8, { OutlineBrush: '#80112233' })).toMatchObject({ color: '#112233', opacity: 128 / 255 });
  });

  it('skips light sources with a reason', () => {
    expect(marker(4, 40, 0, { ChangeIllumination: true })).toMatch(/light/);
  });
});
