import { describe, expect, it } from 'vitest';
import { collectDaMaps, daFloorName, parseDaFloor } from './dungeonAlchemist';

type Wall = { c: [number, number, number, number]; move?: number; sense?: number; door?: number; ds?: number };

function scene(walls: Wall[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'Inn_00',
    width: 1000,
    height: 800,
    grid: 100,
    shiftX: 0,
    shiftY: 0,
    gridDistance: 5,
    gridUnits: 'ft',
    padding: 0,
    globalLight: true,
    darkness: 0,
    lights: [],
    walls,
    ...extra,
  });
}

// A 2 x 2 square room drawn as four loose segments, the way Dungeon Alchemist writes them.
const ROOM: Wall[] = [
  { c: [300, 300, 100, 300] },
  { c: [100, 100, 100, 300] },
  { c: [300, 100, 100, 100] },
  { c: [300, 100, 300, 300] },
];

describe('collectDaMaps', () => {
  it('pairs each floor JSON with its picture and orders floors', () => {
    const maps = collectDaMaps([
      'Inn_01.json',
      'Inn_01.webp',
      'Inn_01.jpg',
      'Inn_00.png',
      'Inn_00.json',
      'Inn.dam',
      'notes.txt',
      'Old Mill-_00.json',
      'Old Mill-_00.jpg',
    ]);
    expect(maps).toEqual([
      {
        name: 'Inn',
        project: 'Inn.dam',
        floors: [
          { index: 0, json: 'Inn_00.json', image: 'Inn_00.png' },
          { index: 1, json: 'Inn_01.json', image: 'Inn_01.webp' },
        ],
      },
      { name: 'Old Mill', project: null, floors: [{ index: 0, json: 'Old Mill-_00.json', image: 'Old Mill-_00.jpg' }] },
    ]);
    expect(daFloorName(maps[0]!, maps[0]!.floors[1]!)).toBe('Inn – Floor 2');
    expect(daFloorName(maps[1]!, maps[1]!.floors[0]!)).toBe('Old Mill');
  });

  it('reads single-floor Foundry exports and finds their project by name', () => {
    const maps = collectDaMaps(['Forest - Foundry_Export.json', 'Forest - Foundry_Export.jpg', 'Forest.dam']);
    expect(maps).toEqual([
      {
        name: 'Forest',
        project: 'Forest.dam',
        floors: [{ index: 0, json: 'Forest - Foundry_Export.json', image: 'Forest - Foundry_Export.jpg' }],
      },
    ]);
  });

  it('names a floor JSON that has no picture', () => {
    expect(() => collectDaMaps(['Inn_00.json'])).toThrow(/"Inn_00.json" has no picture next to it/);
  });
});

describe('parseDaFloor', () => {
  it('joins loose wall segments into a closed room in feet', () => {
    const floor = parseDaFloor(scene(ROOM), 'Inn_00.json');
    expect(floor.calibration).toEqual({ pxPerSquare: 100, rotationDeg: 0, offsetPx: { x: 0, y: 0 } });
    expect(floor.image).toEqual({ widthPx: 1000, heightPx: 800 });
    expect(floor.content.walls).toHaveLength(1);
    expect(floor.content.walls[0]).toMatchObject({ closed: true, heightFt: 10, blocksSight: true });
    expect(floor.content.walls[0]!.points).toHaveLength(4);
    expect(floor.content.walls[0]!.points).toContainEqual({ x: 5, y: 15 });
  });

  it('puts doors into the wall they continue, with state and secrecy', () => {
    const walls: Wall[] = [
      { c: [100, 100, 200, 100] },
      { c: [200, 100, 300, 100], door: 1, ds: 2 },
      { c: [300, 100, 400, 100] },
      { c: [400, 200, 500, 200], door: 2 },
    ];
    const { walls: built, openings } = parseDaFloor(scene(walls), 'Inn_00.json').content;
    const long = built.find((w) => w.points.length === 2 && w.points[1]!.x === 20)!;
    expect(long.points).toEqual([
      { x: 5, y: 5 },
      { x: 20, y: 5 },
    ]);
    expect(openings).toContainEqual(
      expect.objectContaining({ wallId: long.id, kind: 'door', state: 'locked', secret: false, widthFt: 5 }),
    );
    expect(openings).toContainEqual(expect.objectContaining({ kind: 'door', state: 'closed', secret: true }));
  });

  it('maps Foundry sense flags to wall heights and blocking', () => {
    const walls: Wall[] = [
      { c: [0, 0, 100, 0], sense: 0 },
      { c: [0, 500, 100, 500], sense: 2 },
      { c: [0, 700, 100, 700], move: 0, sense: 1 },
      { c: [0, 900, 100, 900], move: 0, sense: 0 },
    ];
    const built = parseDaFloor(scene(walls), 'Inn_00.json').content.walls;
    expect(built).toHaveLength(3);
    expect(built).toContainEqual(
      expect.objectContaining({ heightFt: 3, blocksSight: false, blocksMovement: true, blocksLight: false }),
    );
    expect(built).toContainEqual(expect.objectContaining({ heightFt: 3, blocksSight: true, blocksMovement: true }));
    expect(built).toContainEqual(expect.objectContaining({ heightFt: 10, blocksSight: true, blocksMovement: false }));
  });

  it('removes Foundry padding, converts light radii and keeps the grid shift', () => {
    const floor = parseDaFloor(
      scene([{ c: [350, 300, 450, 300] }], {
        padding: 0.25,
        shiftX: 12,
        shiftY: -4,
        gridDistance: 10,
        globalLight: false,
        darkness: 0.8,
        lights: [{ x: 500, y: 450, dim: 40, bright: 20, tintColor: '#FF9A00', tintAlpha: 0.1 }],
      }),
      'Inn_00.json',
    );
    // Padding: ceil(1000 * 0.25 / 100) * 100 = 300 px, ceil(800 * 0.25 / 100) * 100 = 200 px.
    expect(floor.content.walls[0]!.points).toEqual([
      { x: 2.5, y: 5 },
      { x: 7.5, y: 5 },
    ]);
    expect(floor.content.lights).toMatchObject([
      { position: { x: 10, y: 12.5, elevationFt: 5 }, brightFt: 10, dimFt: 10, color: '#ff9a00' },
    ]);
    expect(floor.calibration.offsetPx).toEqual({ x: -12, y: 4 });
    expect(floor.content.ambientLight).toBe('dim');
    expect(floor.content.notes).toMatch(/baked into the battlemap image; ambient light is dim instead of darkness/);
  });

  it('names the file and field of an invalid floor', () => {
    expect(() => parseDaFloor(JSON.stringify({ width: 10 }), 'Inn_03.json')).toThrow(
      /"Inn_03.json" is not a valid Dungeon Alchemist floor \(height: /,
    );
    expect(() => parseDaFloor(scene([{ c: [0, 0, 1, 1], door: 5 }]), 'Inn_04.json')).toThrow(/walls\.0\.door/);
  });
});
