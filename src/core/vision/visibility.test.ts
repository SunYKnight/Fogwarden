import { describe, expect, it } from 'vitest';
import { BitSet } from '../binary';
import { createMap } from '../model/factories';
import type { BattleMap, LightLevel, Opening, Wall } from '../model';
import { HeightField } from '../terrain/heightfield';
import {
  accumulateExplored,
  composeFog,
  FOG_EXPLORED,
  FOG_UNKNOWN,
  FOG_VISIBLE,
  readFogBits,
  viewFog,
  type FogSources,
} from './fog';
import { computeVisibility, type VisionCombatant } from './visibility';

// 10x10 squares, one fog cell each: cell (c, r) centre = (c*5+2.5, r*5+2.5).
function testMap(ambient: LightLevel = 'bright'): BattleMap {
  return {
    ...createMap({ name: 'test', image: null, squaresX: 10, squaresY: 10, pxPerSquare: 50 }),
    ambientLight: ambient,
  };
}

function wall(points: [number, number][], heightFt = 10, id = 'w1'): Wall {
  return {
    id,
    points: points.map(([x, y]) => ({ x, y })),
    closed: false,
    heightFt,
    thicknessFt: 0.5,
    baseFt: null,
    material: 'stone',
    blocksSight: true,
    blocksMovement: true,
    blocksLight: true,
  };
}

function opening(kind: Opening['kind'], state: Opening['state'], extra: Partial<Opening> = {}): Opening {
  return {
    id: 'o1',
    wallId: 'w1',
    segment: 0,
    t: 0.5,
    widthFt: 5,
    heightFt: 7,
    sillFt: 0,
    kind,
    state,
    secret: false,
    ...extra,
  };
}

function viewer(x: number, y: number, extra: Partial<VisionCombatant> = {}): VisionCombatant {
  return {
    id: `v${x}-${y}`,
    position: { x, y, elevationFt: 0 },
    size: 'medium',
    senses: {},
    visionSource: true,
    light: null,
    ...extra,
  };
}

function see(map: BattleMap, combatants: VisionCombatant[], openingStates: Record<string, Opening['state']> = {}) {
  const state = { openingStates, combatants, cellsPerSquare: 1 };
  const bySource = [...computeVisibility(map, HeightField.fromMap(map), state).values()];
  return (col: number, row: number) => bySource.some((visible) => visible[row * 10 + col] === FOG_VISIBLE);
}

// Wall along x = 25, full map height; its opening spans y = 22.5 .. 27.5.
const SPLIT: [number, number][] = [
  [25, 0],
  [25, 50],
];

describe('line of sight', () => {
  it('passes an open door and stops at a closed one', () => {
    const map = { ...testMap(), walls: [wall(SPLIT)], openings: [opening('door', 'closed')] };
    const closed = see(map, [viewer(12.5, 25)]);
    expect(closed(2, 5)).toBe(true);
    expect(closed(7, 5)).toBe(false);
    const open = see(map, [viewer(12.5, 25)], { o1: 'open' });
    expect(open(7, 5)).toBe(true);
    expect(open(7, 0)).toBe(false);
  });

  it('lets sight through a closed window but not through the wall below its sill', () => {
    const window = opening('window', 'closed', { sillFt: 3, heightFt: 4 });
    const map = { ...testMap(), walls: [wall(SPLIT)], openings: [window] };
    const visible = see(map, [viewer(12.5, 25)]);
    expect(visible(9, 5)).toBe(true);
    expect(visible(5, 5)).toBe(false);
  });

  it('keeps a secret door shut for players until it is opened', () => {
    const map = { ...testMap(), walls: [wall(SPLIT)], openings: [opening('door', 'closed', { secret: true })] };
    expect(see(map, [viewer(12.5, 25)])(7, 5)).toBe(false);
    expect(see(map, [viewer(12.5, 25)], { o1: 'open' })(7, 5)).toBe(true);
  });

  it('lets a tall viewer look over a low wall a medium one cannot', () => {
    const map = { ...testMap(), walls: [wall(SPLIT, 3)] };
    expect(see(map, [viewer(2.5, 27.5)])(9, 5)).toBe(false);
    expect(see(map, [viewer(2.5, 27.5, { size: 'huge' })])(9, 5)).toBe(true);
  });

  it('hides cells behind a hill', () => {
    const map = testMap();
    const terrain = HeightField.fromMap(map);
    for (let row = 0; row < terrain.rows; row++) {
      for (let col = 0; col < terrain.cols; col++) {
        const x = col * terrain.spacingFt;
        terrain.data[terrain.index(col, row)] = x >= 20 && x <= 30 ? 8 : 0;
      }
    }
    const hiker = viewer(2.5, 27.5);
    const state = { openingStates: {}, combatants: [hiker], cellsPerSquare: 1 };
    const visible = computeVisibility(map, terrain, state).get(hiker.id)!;
    expect(visible[5 * 10 + 3]).toBe(FOG_VISIBLE);
    expect(visible[5 * 10 + 9]).toBe(0);
    const climber = viewer(22.5, 27.5, { position: { x: 22.5, y: 27.5, elevationFt: 8 } });
    const onHill = { ...state, combatants: [climber] };
    expect(computeVisibility(map, terrain, onHill).get(climber.id)![5 * 10 + 0]).toBe(FOG_VISIBLE);
  });

  it('keeps the sight of each vision source apart', () => {
    const map = { ...testMap(), walls: [wall(SPLIT)], openings: [opening('door', 'closed')] };
    const west = viewer(12.5, 25);
    const east = viewer(37.5, 25);
    const goblin = { ...viewer(47.5, 47.5), visionSource: false };
    const state = { openingStates: {}, combatants: [west, east, goblin], cellsPerSquare: 1 };
    const bySource = computeVisibility(map, HeightField.fromMap(map), state);
    expect([...bySource.keys()]).toEqual([west.id, east.id]);
    expect(bySource.get(west.id)![5 * 10 + 2]).toBe(FOG_VISIBLE);
    expect(bySource.get(west.id)![5 * 10 + 7]).toBe(0);
    expect(bySource.get(east.id)![5 * 10 + 7]).toBe(FOG_VISIBLE);
    expect(bySource.get(east.id)![5 * 10 + 2]).toBe(0);
  });
});

describe('light and senses', () => {
  it('limits darkvision in darkness to its range', () => {
    const map = testMap('darkness');
    const darkvision = see(map, [viewer(2.5, 2.5, { senses: { darkvision: 30 } })]);
    expect(darkvision(6, 0)).toBe(true);
    expect(darkvision(7, 0)).toBe(false);
    expect(see(map, [viewer(2.5, 2.5)])(0, 0)).toBe(false);
  });

  it('needs truesight to see into magical darkness', () => {
    const polygon = [
      { x: 20, y: 0 },
      { x: 35, y: 0 },
      { x: 35, y: 50 },
      { x: 20, y: 50 },
    ];
    const region = {
      id: 'r1',
      name: 'Darkness',
      polygon,
      kind: 'light' as const,
      light: 'magical-darkness' as const,
      color: '#000000',
      hiddenFromPlayers: true,
      notes: '',
      sound: null,
    };
    const map = { ...testMap(), regions: [region] };
    expect(see(map, [viewer(2.5, 2.5, { senses: { darkvision: 60 } })])(5, 0)).toBe(false);
    expect(see(map, [viewer(2.5, 2.5, { senses: { truesight: 60 } })])(5, 0)).toBe(true);
    expect(see(map, [viewer(2.5, 2.5, { senses: { truesight: 10 } })])(5, 0)).toBe(false);
  });

  it('casts light shadows behind walls', () => {
    const torch = {
      id: 'l1',
      name: 'Torch',
      position: { x: 12.5, y: 12.5, elevationFt: 5 },
      brightFt: 30,
      dimFt: 0,
      color: '#ffcc88',
      enabled: true,
      attachedTo: null,
    };
    const map = {
      ...testMap('darkness'),
      walls: [
        wall([
          [20, 5],
          [20, 20],
        ]),
      ],
      lights: [torch],
    };
    const visible = see(map, [viewer(27.5, 47.5)]);
    expect(visible(5, 2)).toBe(false);
    expect(visible(5, 6)).toBe(true);
  });

  it('carries an attached light with its combatant', () => {
    const lantern = {
      id: 'l1',
      name: 'Lantern',
      position: { x: 0, y: 0, elevationFt: 0 },
      brightFt: 10,
      dimFt: 10,
      color: '#ffcc88',
      enabled: true,
      attachedTo: 'carrier',
    };
    const map = { ...testMap('darkness'), lights: [lantern] };
    const visible = see(map, [viewer(27.5, 27.5, { id: 'carrier' })]);
    expect(visible(5, 5)).toBe(true);
    expect(visible(5, 8)).toBe(true);
    expect(visible(6, 9)).toBe(false);
  });

  it('lights the dark with a light the combatant carries', () => {
    const map = testMap('darkness');
    const light = { name: 'Lantern', brightFt: 10, dimFt: 10, color: '#ffcc88' };
    const visible = see(map, [viewer(27.5, 27.5, { light })]);
    expect(visible(5, 5)).toBe(true);
    expect(visible(5, 8)).toBe(true);
    expect(visible(6, 9)).toBe(false);
    expect(see(map, [viewer(27.5, 27.5)])(5, 8)).toBe(false);
  });

  it('lets blindsight ignore darkness within range only', () => {
    const map = testMap('magical-darkness');
    const visible = see(map, [viewer(2.5, 2.5, { senses: { blindsight: 10 } })]);
    expect(visible(2, 0)).toBe(true);
    expect(visible(3, 0)).toBe(false);
  });
});

describe('fog memory', () => {
  it('accumulates explored cells and applies DM overrides', () => {
    const explored = new BitSet(4);
    const revealed = new BitSet(4);
    const hidden = new BitSet(4);
    hidden.set(3, true);
    revealed.set(2, true);
    expect(accumulateExplored(explored, Uint8Array.from([FOG_VISIBLE, 0, 0, FOG_VISIBLE]), hidden)).toBe(true);
    expect(explored.get(3)).toBe(false);
    expect(
      Array.from(composeFog(Uint8Array.from([0, FOG_VISIBLE, 0, FOG_VISIBLE]), explored, revealed, hidden)),
    ).toEqual([FOG_EXPLORED, FOG_VISIBLE, FOG_EXPLORED, FOG_UNKNOWN]);
    expect(accumulateExplored(explored, Uint8Array.from([FOG_VISIBLE, 0, 0, 0]), hidden)).toBe(false);
  });

  it('keeps explored cells per character and gives the party their union', () => {
    const bits = (...set: number[]) => {
      const result = new BitSet(4);
      set.forEach((i) => result.set(i, true));
      return result;
    };
    const sources: FogSources = {
      size: { cellsX: 4, cellsY: 1, cellFt: 5 },
      visible: new Map([
        ['a', Uint8Array.from([FOG_VISIBLE, 0, 0, 0])],
        ['b', Uint8Array.from([0, 0, FOG_VISIBLE, 0])],
      ]),
      explored: new Map([
        ['a', bits(0, 1)],
        ['b', bits(2, 3)],
      ]),
      revealed: bits(),
      hidden: bits(),
    };
    const V = FOG_VISIBLE;
    const E = FOG_EXPLORED;
    const U = FOG_UNKNOWN;
    expect(Array.from(viewFog(sources, ['a']).cells)).toEqual([V, E, U, U]);
    expect(Array.from(viewFog(sources, ['b']).cells)).toEqual([U, U, V, E]);
    expect(Array.from(viewFog(sources, ['a', 'b']).cells)).toEqual([V, E, V, E]);
    expect(Array.from(viewFog(sources, ['nobody']).cells)).toEqual([U, U, U, U]);
  });

  it('drops stored fog that belongs to another map size', () => {
    const bits = new BitSet(16);
    bits.set(5, true);
    expect(readFogBits(bits.toBase64(), 16).get(5)).toBe(true);
    expect(readFogBits(bits.toBase64(), 100).get(5)).toBe(false);
  });
});
