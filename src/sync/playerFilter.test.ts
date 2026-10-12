import { describe, expect, it } from 'vitest';
import { BitSet } from '@/core/binary';
import { createEncounter, createMap, type BattleMap, type Combatant, type Encounter } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import {
  exploreBySource,
  FOG_EXPLORED,
  FOG_VISIBLE,
  fogSize,
  viewFog,
  type FogCells,
  type FogSources,
} from '@/core/vision/fog';
import { computeVisibility } from '@/core/vision/visibility';
import { filterEncounterForPlayers, filterMapForPlayers, healthBand, playerMapInputs } from './playerFilter';

function combatant(id: string, extra: Partial<Combatant> = {}): Combatant {
  return {
    id,
    creature: null,
    name: id,
    side: 'enemy',
    size: 'medium',
    armorClass: 12,
    hp: { current: 10, max: 10, temp: 0 },
    initiative: null,
    conditions: [],
    position: { x: 2.5, y: 2.5, elevationFt: 0 },
    facingDeg: 0,
    senses: {},
    visionSource: false,
    hiddenFromPlayers: false,
    token: null,
    notes: 'DM secret',
    ...extra,
  };
}

function secretMap(): BattleMap {
  const map = createMap({ name: 'm', image: null, squaresX: 4, squaresY: 1, pxPerSquare: 50 });
  const opening = {
    wallId: 'w1',
    segment: 0,
    t: 0.5,
    widthFt: 5,
    heightFt: 7,
    sillFt: 0,
    kind: 'door' as const,
    state: 'closed' as const,
  };
  const region = {
    name: 'r',
    polygon: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ],
    kind: 'note' as const,
    light: null,
    color: '#ff0000',
  };
  return {
    ...map,
    notes: 'map secret',
    openings: [
      { ...opening, id: 'secret', secret: true },
      { ...opening, id: 'plain', secret: false },
    ],
    regions: [
      { ...region, id: 'hidden', hiddenFromPlayers: true, notes: 'trap' },
      { ...region, id: 'shown', hiddenFromPlayers: false, notes: 'DM note' },
    ],
  };
}

// Four cells in a row: the first is visible, the second only explored.
const FOG: FogCells = {
  size: fogSize(createMap({ name: 'm', image: null, squaresX: 4, squaresY: 1, pxPerSquare: 50 }).grid, 1),
  cells: Uint8Array.from([FOG_VISIBLE, FOG_EXPLORED, 0, 0]),
};

function encounterWith(combatants: Combatant[], extra: Partial<Encounter> = {}): Encounter {
  return { ...createEncounter('e', 'c1', null), combatants, ...extra };
}

describe('filterMapForPlayers', () => {
  it('drops closed secret doors, hidden regions and notes', () => {
    const map = secretMap();
    const filtered = filterMapForPlayers(map, encounterWith([]));
    expect(filtered.openings.map((o) => o.id)).toEqual(['plain']);
    expect(filtered.regions.map((r) => r.id)).toEqual(['shown']);
    expect(filtered.regions[0]!.notes).toBe('');
    expect(filtered.notes).toBe('');
    expect(JSON.stringify(filtered)).not.toMatch(/"id":"secret"|trap|DM note|map secret/);
  });

  it('turns an opened secret door into a plain door and changes its inputs key', () => {
    const map = secretMap();
    const closed = encounterWith([]);
    const opened = encounterWith([], { openingStates: { secret: 'open' } });
    const filtered = filterMapForPlayers(map, opened);
    expect(filtered.openings.find((o) => o.id === 'secret')?.secret).toBe(false);
    expect(playerMapInputs(map, opened)).not.toBe(playerMapInputs(map, closed));
  });

  it('removes lights carried by hidden combatants', () => {
    const light = {
      id: 'torch',
      name: 'Torch',
      position: { x: 0, y: 0, elevationFt: 0 },
      brightFt: 20,
      dimFt: 20,
      color: '#ffffff',
      enabled: true,
      attachedTo: 'lurker',
    };
    const map = { ...secretMap(), lights: [light] };
    const lurker = combatant('lurker', { hiddenFromPlayers: true });
    expect(filterMapForPlayers(map, encounterWith([lurker])).lights).toEqual([]);
    expect(filterMapForPlayers(map, encounterWith([{ ...lurker, hiddenFromPlayers: false }])).lights).toHaveLength(1);
  });
});

describe('filterEncounterForPlayers', () => {
  it('never sends hidden combatants and sends others only in visible cells', () => {
    const encounter = encounterWith([
      combatant('hidden-in-view', { hiddenFromPlayers: true }),
      combatant('hidden-pc', { side: 'player', hiddenFromPlayers: true }),
      combatant('in-view'),
      combatant('remembered', { position: { x: 7.5, y: 2.5, elevationFt: 0 } }),
      combatant('dark', { position: { x: 12.5, y: 2.5, elevationFt: 0 } }),
      combatant('unplaced', { position: null }),
      combatant('pc-far', { side: 'player', position: { x: 17.5, y: 2.5, elevationFt: 0 } }),
    ]);
    const filtered = filterEncounterForPlayers(encounter, secretMap(), FOG);
    expect(filtered.combatants.map((c) => c.id)).toEqual(['in-view', 'pc-far']);
    expect(JSON.stringify(filtered)).not.toMatch(/DM secret|hidden/);
    expect(filterEncounterForPlayers(encounter, secretMap(), null).combatants.map((c) => c.id)).toEqual(['pc-far']);
  });

  it('hides whose turn it is when that combatant is not shown', () => {
    const encounter = encounterWith([combatant('lurker', { hiddenFromPlayers: true }), combatant('in-view')], {
      round: 1,
      turnIndex: 0,
    });
    expect(filterEncounterForPlayers(encounter, null, FOG).activeCombatantId).toBeNull();
    expect(filterEncounterForPlayers({ ...encounter, turnIndex: 1 }, null, FOG).activeCombatantId).toBe('in-view');
  });

  it('keeps only shared markers and door states without closed secret doors', () => {
    const marker = {
      id: 'm1',
      templateId: null,
      label: '',
      shape: 'sphere' as const,
      sizeFt: 20,
      widthFt: 5,
      heightFt: 20,
      origin: { x: 0, y: 0, elevationFt: 0 },
      directionDeg: 0,
      color: '#ff0000',
      opacity: 0.4,
    };
    const encounter = encounterWith([], {
      markers: [
        { ...marker, id: 'shared', visibleToPlayers: true },
        { ...marker, id: 'dm-only', visibleToPlayers: false },
      ],
      openingStates: { secret: 'locked', plain: 'open' },
    });
    const filtered = filterEncounterForPlayers(encounter, secretMap(), FOG);
    expect(filtered.markers.map((m) => m.id)).toEqual(['shared']);
    expect(filtered.openingStates).toEqual({ plain: 'open' });
    const opened = filterEncounterForPlayers({ ...encounter, openingStates: { secret: 'open' } }, secretMap(), FOG);
    expect(opened.openingStates).toEqual({ secret: 'open' });
  });

  it('gives non-player combatants a health band instead of hit points', () => {
    const encounter = encounterWith([
      combatant('goblin', { hp: { current: 3, max: 7, temp: 0 } }),
      combatant('pc', { side: 'player', hp: { current: 1, max: 30, temp: 0 } }),
    ]);
    const [goblin, pc] = filterEncounterForPlayers(encounter, null, FOG).combatants;
    expect(goblin).toMatchObject({ id: 'goblin', health: 'bloodied' });
    expect(goblin).not.toHaveProperty('hp');
    expect(pc).toMatchObject({ id: 'pc', health: null });
  });
});

describe('healthBand', () => {
  it('maps hit points to bands', () => {
    expect(healthBand({ current: 10, max: 10, temp: 0 })).toBe('unhurt');
    expect(healthBand({ current: 6, max: 10, temp: 0 })).toBe('hurt');
    expect(healthBand({ current: 5, max: 10, temp: 0 })).toBe('bloodied');
    expect(healthBand({ current: 0, max: 10, temp: 0 })).toBe('down');
  });
});

describe('per-character views', () => {
  // Four squares in a row, one fog cell each; a wall at x = 10 splits them.
  const map: BattleMap = {
    ...createMap({ name: 'm', image: null, squaresX: 4, squaresY: 1, pxPerSquare: 50 }),
    walls: [
      {
        id: 'w1',
        points: [
          { x: 10, y: 0 },
          { x: 10, y: 5 },
        ],
        closed: false,
        heightFt: 10,
        thicknessFt: 0.5,
        baseFt: null,
        material: 'stone',
        blocksSight: true,
        blocksMovement: true,
        blocksLight: true,
      },
    ],
  };
  const terrain = HeightField.fromMap(map);
  const size = fogSize(map.grid, 1);
  const at = (x: number) => ({ x, y: 2.5, elevationFt: 0 });
  const pc = (id: string, x: number) => combatant(id, { side: 'player', visionSource: true, position: at(x) });

  function look(encounter: Encounter, explored: Map<string, BitSet>) {
    const state = { openingStates: {}, combatants: encounter.combatants, cellsPerSquare: 1 };
    const visible = computeVisibility(map, terrain, state);
    exploreBySource(explored, visible, new BitSet(4));
    const sources: FogSources = { size, visible, explored, revealed: new BitSet(4), hidden: new BitSet(4) };
    const view = (ids: string[]) => {
      const fog = viewFog(sources, ids);
      return {
        cells: Array.from(fog.cells),
        ids: filterEncounterForPlayers(encounter, map, fog).combatants.map((c) => c.id),
      };
    };
    return { thorin: view(['thorin']), elara: view(['elara']), party: view(['thorin', 'elara']) };
  }

  it('shows a character only what it sees and the party what anyone sees', () => {
    const goblin = combatant('goblin', { position: at(12.5) });
    const seen = look(encounterWith([pc('thorin', 2.5), pc('elara', 17.5), goblin]), new Map());
    expect(seen.thorin).toEqual({ cells: [FOG_VISIBLE, FOG_VISIBLE, 0, 0], ids: ['thorin', 'elara'] });
    expect(seen.elara).toEqual({ cells: [0, 0, FOG_VISIBLE, FOG_VISIBLE], ids: ['thorin', 'elara', 'goblin'] });
    expect(seen.party.cells).toEqual([FOG_VISIBLE, FOG_VISIBLE, FOG_VISIBLE, FOG_VISIBLE]);
    expect(seen.party.ids).toEqual(['thorin', 'elara', 'goblin']);
  });

  it('remembers explored cells per character and gives the party their union', () => {
    const explored = new Map<string, BitSet>();
    const goblin = combatant('goblin', { position: at(12.5) });
    look(encounterWith([pc('thorin', 2.5), pc('elara', 17.5), goblin]), explored);
    const later = look(encounterWith([pc('thorin', 2.5), pc('elara', 7.5), goblin]), explored);
    expect(later.thorin.cells).toEqual([FOG_VISIBLE, FOG_VISIBLE, 0, 0]);
    expect(later.elara.cells).toEqual([FOG_VISIBLE, FOG_VISIBLE, FOG_EXPLORED, FOG_EXPLORED]);
    expect(later.party.cells).toEqual([FOG_VISIBLE, FOG_VISIBLE, FOG_EXPLORED, FOG_EXPLORED]);
    expect(later.party.ids).toEqual(['thorin', 'elara']);
  });
});
