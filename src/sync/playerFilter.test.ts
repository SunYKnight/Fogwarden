import { describe, expect, it } from 'vitest';
import { BitSet } from '@/core/binary';
import {
  createCreature,
  createEncounter,
  createMap,
  freshCombatState,
  PARTY_VIEW,
  type BattleMap,
  type Combatant,
  type Encounter,
} from '@/core/model';
import type { Spell } from '@/core/spells';
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
import {
  characterDetails,
  filterEncounterForPlayers,
  filterMapForPlayers,
  healthBand,
  ownCharacter,
  playerMapInputs,
} from './playerFilter';

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
    ...freshCombatState(null),
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
    sound: null,
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

  it('gives every combatant a health band instead of hit points', () => {
    const encounter = encounterWith([
      combatant('goblin', { hp: { current: 2, max: 7, temp: 0 } }),
      combatant('pc', { side: 'player', hp: { current: 1, max: 30, temp: 0 } }),
    ]);
    const [goblin, pc] = filterEncounterForPlayers(encounter, null, FOG).combatants;
    expect(goblin).toMatchObject({ id: 'goblin', health: 'critical' });
    expect(goblin).not.toHaveProperty('hp');
    expect(pc).toMatchObject({ id: 'pc', health: 'critical' });
    expect(pc).not.toHaveProperty('hp');
  });

  it('sends the creature type icon of shown library creatures only', () => {
    const goblin = { area: 'content' as const, id: 'goblin' };
    const encounter = encounterWith([combatant('goblin', { creature: goblin }), combatant('pc', { side: 'player' })]);
    const [shown, pc] = filterEncounterForPlayers(encounter, null, FOG, {
      showTurnOrder: false,
      standees: true,
      tokenOf: () => null,
      typeIconOf: (c) => (c.creature ? 'humanoid' : null),
    }).combatants;
    expect(shown).toMatchObject({ id: 'goblin', typeIcon: 'humanoid' });
    expect(pc).not.toHaveProperty('typeIcon');
    expect(filterEncounterForPlayers(encounter, null, FOG).combatants[0]).not.toHaveProperty('typeIcon');
  });
});

describe('healthBand', () => {
  it('cuts at thirds of the maximum, the boundaries counting to the better band', () => {
    expect(healthBand({ current: 9, max: 9, temp: 0 })).toBe('healthy');
    expect(healthBand({ current: 6, max: 9, temp: 0 })).toBe('healthy');
    expect(healthBand({ current: 5, max: 9, temp: 0 })).toBe('wounded');
    expect(healthBand({ current: 3, max: 9, temp: 0 })).toBe('wounded');
    expect(healthBand({ current: 2, max: 9, temp: 0 })).toBe('critical');
    expect(healthBand({ current: 0, max: 9, temp: 0 })).toBe('down');
    expect(healthBand({ current: -3, max: 9, temp: 0 })).toBe('down');
  });
});

describe('character sheets', () => {
  it('belong to the view of their own shown player character only, never to another view or the party', () => {
    const encounter = encounterWith([
      combatant('thorin', { side: 'player' }),
      combatant('elara', { side: 'player' }),
      combatant('hidden-pc', { side: 'player', hiddenFromPlayers: true }),
      combatant('goblin'),
    ]);
    expect(ownCharacter(encounter, 'thorin')?.id).toBe('thorin');
    expect(ownCharacter(encounter, 'elara')?.id).toBe('elara');
    expect(ownCharacter(encounter, PARTY_VIEW)).toBeUndefined();
    expect(ownCharacter(encounter, 'goblin')).toBeUndefined();
    expect(ownCharacter(encounter, 'hidden-pc')).toBeUndefined();
    expect(ownCharacter(encounterWith([combatant(PARTY_VIEW, { side: 'player' })]), PARTY_VIEW)).toBeUndefined();
  });

  it('come from the stat block without a sheet file, expertise where the bonus holds proficiency twice', () => {
    const creature = {
      ...createCreature('Awen'),
      kind: 'player' as const,
      level: 1,
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 12, cha: 10 },
      savingThrows: { dex: 4 },
      skills: { stealth: 6, perception: 3 },
      traits: [{ name: 'Keen Senses', description: 'Sees far.' }],
    };
    const { sheet, spells } = characterDetails(creature, undefined, new Map());
    expect(sheet.savingThrows.dex).toEqual({ proficient: true, bonus: 4 });
    expect(sheet.savingThrows.wis).toEqual({ proficient: false, bonus: 1 });
    expect(sheet.skills.stealth).toEqual({ proficiency: 'expertise', bonus: 6 });
    expect(sheet.skills.perception).toEqual({ proficiency: 'proficient', bonus: 3 });
    expect(sheet.skills.acrobatics).toEqual({ proficiency: 'none', bonus: 2 });
    expect(sheet.features).toEqual([{ name: 'Keen Senses', source: '', text: 'Sees far.' }]);
    expect(spells).toEqual({});
  });

  it('carry the library texts of the spells they name', () => {
    const creature = { ...createCreature('Awen'), kind: 'player' as const };
    const base = characterDetails(creature, undefined, new Map()).sheet;
    const stored = {
      ...base,
      spells: [
        { name: 'Aid', level: 2, status: 'prepared' as const, source: 'Cleric', spell: 'aid' },
        { name: 'Lost', level: 1, status: 'known' as const, source: 'Cleric', spell: 'gone' },
      ],
    };
    const aid: Spell = {
      id: 'aid',
      name: 'Aid',
      level: 2,
      school: 'Abjuration',
      castingTime: '1 action',
      range: '30 feet',
      components: 'V, S, M',
      duration: '8 hours',
      ritual: false,
      classes: ['Cleric'],
      source: 'SRD',
      createdAt: null,
      updatedAt: null,
      description: 'Bolsters allies.',
    };
    const { sheet, spells } = characterDetails(creature, stored, new Map([['aid', aid]]));
    expect(sheet).toBe(stored);
    expect(Object.keys(spells)).toEqual(['aid']);
    expect(spells.aid).toMatchObject({ school: 'Abjuration', description: 'Bolsters allies.' });
  });
});

describe('which creatures players see', () => {
  // 4 x 4 squares at two fog cells per square: 8 x 8 cells of 2.5 ft.
  const size = fogSize(createMap({ name: 'm', image: null, squaresX: 4, squaresY: 4, pxPerSquare: 50 }).grid, 2);
  const fogWith = (visible: [number, number][]) => {
    const cells = new Uint8Array(64);
    visible.forEach(([col, row]) => (cells[row * 8 + col] = FOG_VISIBLE));
    return { size, cells };
  };
  const shown = (c: Combatant, visible: [number, number][]) =>
    filterEncounterForPlayers(encounterWith([c]), null, fogWith(visible)).combatants.length === 1;

  it('shows a creature when any cell of its space is visible, whichever side it is seen from', () => {
    // A medium goblin in square (1, 1) covers cells 2..3 in both directions.
    const goblin = combatant('goblin', { position: { x: 7.5, y: 7.5, elevationFt: 0 } });
    expect(shown(goblin, [[2, 2]])).toBe(true);
    expect(shown(goblin, [[3, 3]])).toBe(true);
    expect(
      shown(goblin, [
        [1, 2],
        [4, 3],
        [2, 4],
      ]),
    ).toBe(false);
  });

  it('counts the whole space of large creatures', () => {
    // A large ogre on the corner between squares (0..1, 0..1) covers cells 0..3.
    const ogre = combatant('ogre', { size: 'large', position: { x: 5, y: 5, elevationFt: 0 } });
    expect(shown(ogre, [[0, 0]])).toBe(true);
    expect(shown(ogre, [[3, 3]])).toBe(true);
    expect(shown(ogre, [[4, 4]])).toBe(false);
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
