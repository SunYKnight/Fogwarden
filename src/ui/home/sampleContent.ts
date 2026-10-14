import { SRD_ID_PREFIX } from '@/core/import/dnd5eApi';
import {
  createEncounter,
  defaultAtmosphere,
  type BattleMap,
  type CarriedLight,
  type Combatant,
  type Creature,
  type DocRef,
  type Encounter,
  type MapPoint,
  type MarkerTemplate,
  type Side,
} from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import type { Repository } from '@/data/repository';
import { addEffect, effectExpiry } from '@/state/combatRules';
import { createPc, spawnCombatant, type PcOptions } from '@/state/encounterActions';

/** Shipped sample map built by `tools/build-sample.ts`. */
export const SAMPLE_MAP: DocRef = { area: 'content', id: 'sample-chapel' };
export const SAMPLE_GOBLIN: DocRef = { area: 'content', id: 'srd-goblin' };
const SAMPLE_MOONBEAM: DocRef = { area: 'content', id: 'srd-moonbeam' };
// Stable ids let "Open the sample encounter" find what it created earlier.
export const SAMPLE_CAMPAIGN_ID = 'sample-campaign';
export const SAMPLE_ENCOUNTER_ID = 'sample-goblin-ambush';
export const SAMPLE_NIGHT_ID = 'sample-night-vigil';
export const SAMPLE_PREPARED_ID = 'sample-midnight-rite';

/** SRD creatures of the sample encounters, besides the goblin; ids of the D&D 5e API import. */
const SRD = {
  skeleton: { area: 'content', id: 'srd-skeleton' },
  ghoul: { area: 'content', id: 'srd-ghoul' },
  shadow: { area: 'content', id: 'srd-shadow' },
  cultFanatic: { area: 'content', id: 'srd-cult-fanatic' },
  cultist: { area: 'content', id: 'srd-cultist' },
  zombie: { area: 'content', id: 'srd-zombie' },
} as const satisfies Record<string, DocRef>;

type SampleCreature = keyof typeof SRD;

/** D&D 5e API indexes of the sample's monsters, which the API import brings into the data folder. */
export const SAMPLE_MONSTER_INDEXES = [SAMPLE_GOBLIN, ...Object.values(SRD)].map((ref) =>
  ref.id.slice(SRD_ID_PREFIX.length),
);

/** Library documents the sample encounters are built from. */
export interface SampleLibrary {
  map: BattleMap;
  goblin: Creature;
  moonbeam: MarkerTemplate;
  creatures: Record<SampleCreature, Creature>;
}

/** Squares (column, row) matching the drawing: campfire, altar, breach. */
const GOBLIN_SQUARES: [number, number][] = [
  [14, 12],
  [16, 11],
  [10, 5],
  [14, 7],
];

/** Example party; Mirren joins in the second session. */
const PARTY = {
  thorin: { name: 'Thorin (dwarf fighter)', level: 3, armorClass: 18, maxHp: 28, senses: { darkvision: 60 } },
  elara: { name: 'Elara (human cleric)', level: 3, armorClass: 16, maxHp: 24, senses: {} },
  mirren: { name: 'Mirren (half-elf druid)', level: 3, armorClass: 14, maxHp: 21, senses: { darkvision: 60 } },
} satisfies Record<string, Omit<PcOptions, 'visionSource'>>;

/** Values of the Torch preset in the combatant's light picker. */
const TORCH: CarriedLight = { name: 'Torch', brightFt: 20, dimFt: 20, color: '#ffb347' };

/** Converts squares (column, row) of `map` to their centers at terrain height. */
function squarePlacer(map: BattleMap): (square: readonly [number, number]) => MapPoint {
  const terrain = HeightField.fromMap(map);
  const fps = map.grid.feetPerSquare;
  return ([col, row]) => {
    const x = (col + 0.5) * fps;
    const y = (row + 0.5) * fps;
    return { x, y, elevationFt: terrain.sample(x, y) };
  };
}

function partyMember(pc: Omit<PcOptions, 'visionSource'>, position: MapPoint | null): Combatant {
  return { ...createPc({ ...pc, senses: { ...pc.senses }, visionSource: true }), position };
}

/** `count` numbered, unplaced combatants of one creature with average hit points. */
function spawnGroup(creature: Creature, ref: DocRef, side: Side, count: number): Combatant[] {
  return Array.from({ length: count }).reduce<Combatant[]>(
    (list) => [
      ...list,
      spawnCombatant(creature, ref, { hpMode: 'average', side, takenNames: list.map((c) => c.name) }),
    ],
    [],
  );
}

/** Four SRD goblins and two example PCs placed on square centers at terrain height. */
export function createSampleEncounter(map: BattleMap, goblin: Creature): Encounter {
  const at = squarePlacer(map);
  const encounter = createEncounter('Goblin ambush at the chapel', SAMPLE_CAMPAIGN_ID, SAMPLE_MAP);
  const goblins = spawnGroup(goblin, SAMPLE_GOBLIN, 'enemy', GOBLIN_SQUARES.length).map((c, i) => ({
    ...c,
    position: at(GOBLIN_SQUARES[i]!),
  }));
  const party = [partyMember(PARTY.thorin, at([9, 14])), partyMember(PARTY.elara, at([10, 15]))];
  return {
    ...encounter,
    id: SAMPLE_ENCOUNTER_ID,
    combatants: [...party, ...goblins],
    notes: 'Grisk, the goblin boss, waits by the campfire and flees once two goblins fall.',
  };
}

/**
 * Night in the unlit nave: darkvision and a torch against undead, a shadow the players cannot see yet,
 * Moonbeam on the ghoul, Bless and Turn Undead running with their durations.
 */
function createNightEncounter(library: SampleLibrary): Encounter {
  const at = squarePlacer(library.map);
  const { creatures } = library;
  const thorin = partyMember(PARTY.thorin, at([9, 9]));
  const elara = { ...partyMember(PARTY.elara, at([10, 10])), light: TORCH, concentrating: true };
  const mirren = { ...partyMember(PARTY.mirren, at([9, 11])), concentrating: true };
  const skeletons = spawnGroup(creatures.skeleton, SRD.skeleton, 'enemy', 2).map((c, i) => ({
    ...c,
    position: at([9 + 2 * i, 5]),
  }));
  const [ghoul] = spawnGroup(creatures.ghoul, SRD.ghoul, 'enemy', 1).map((c) => ({ ...c, position: at([12, 7]) }));
  const [shadow] = spawnGroup(creatures.shadow, SRD.shadow, 'enemy', 1).map((c) => ({
    ...c,
    position: at([7, 8]),
    hiddenFromPlayers: true,
    notes: 'Hides in the dark corner until someone steps next to it.',
  }));
  const { moonbeam } = library;
  const encounter: Encounter = {
    ...createEncounter('Night vigil in the chapel', SAMPLE_CAMPAIGN_ID, SAMPLE_MAP),
    id: SAMPLE_NIGHT_ID,
    combatants: [thorin, elara, mirren, ...skeletons, ghoul!, shadow!],
    markers: [
      {
        id: `${SAMPLE_NIGHT_ID}-moonbeam`,
        templateId: moonbeam.id,
        label: `${moonbeam.name} (Mirren)`,
        shape: moonbeam.shape,
        sizeFt: moonbeam.sizeFt,
        widthFt: moonbeam.widthFt,
        heightFt: moonbeam.heightFt,
        origin: ghoul!.position,
        directionDeg: 0,
        color: moonbeam.color,
        opacity: moonbeam.opacity,
        visibleToPlayers: true,
        save: moonbeam.save,
      },
    ],
    openingStates: { 'sample-door': 'open' },
    notes:
      'Sister Wren asked the party to keep vigil until midnight. Undead rise in the nave; a shadow waits ' +
      'unseen in the south-west corner. Thorin and Mirren see in the dark, Elara carries a torch.',
    atmosphere: { ...defaultAtmosphere(), mood: 'exploration', minute: 23 * 60 + 30, weather: 'fog' },
  };
  // The tracker counts these down, so they start as if just cast.
  addEffect(encounter, thorin, 'Bless', null, effectExpiry(encounter, thorin.id, { kind: 'rounds', rounds: 10 }));
  const turned = skeletons[1]!;
  addEffect(
    encounter,
    turned,
    'Turn Undead',
    'frightened',
    effectExpiry(encounter, turned.id, { kind: 'rounds', rounds: 10 }),
  );
  return encounter;
}

/** Brother Aldric's rite, prepared with nobody on the map, for the set-up bar's placing. */
function createPreparedEncounter(library: SampleLibrary): Encounter {
  const { creatures } = library;
  const [aldric] = spawnGroup(creatures.cultFanatic, SRD.cultFanatic, 'enemy', 1).map((c) => ({
    ...c,
    name: 'Brother Aldric',
    notes: 'Fights from behind the altar; surrenders below 10 hit points.',
  }));
  return {
    ...createEncounter("Brother Aldric's midnight rite", SAMPLE_CAMPAIGN_ID, SAMPLE_MAP),
    id: SAMPLE_PREPARED_ID,
    combatants: [
      partyMember(PARTY.thorin, null),
      partyMember(PARTY.elara, null),
      partyMember(PARTY.mirren, null),
      aldric!,
      ...spawnGroup(creatures.cultist, SRD.cultist, 'enemy', 3),
      ...spawnGroup(creatures.zombie, SRD.zombie, 'enemy', 2),
    ],
    notes:
      'Nobody is on the map yet: click "not on map – place" in the set-up bar and place everyone one ' +
      'after another. The cultists stand around the altar, the zombies guard the door.',
    atmosphere: { ...defaultAtmosphere(), mood: 'exploration', combatMood: 'boss', minute: 0 },
  };
}

/** Loads what the sample encounters need; fails with the repository's message when a pack is disabled. */
export async function loadSampleLibrary(repository: Repository): Promise<SampleLibrary> {
  const [map, goblin, moonbeam, skeleton, ghoul, shadow, cultFanatic, cultist, zombie] = await Promise.all([
    repository.load('map', SAMPLE_MAP),
    repository.load('creature', SAMPLE_GOBLIN),
    repository.load('marker', SAMPLE_MOONBEAM),
    repository.load('creature', SRD.skeleton),
    repository.load('creature', SRD.ghoul),
    repository.load('creature', SRD.shadow),
    repository.load('creature', SRD.cultFanatic),
    repository.load('creature', SRD.cultist),
    repository.load('creature', SRD.zombie),
  ]);
  return { map, goblin, moonbeam, creatures: { skeleton, ghoul, shadow, cultFanatic, cultist, zombie } };
}

/** Builders of the sample encounters by id. */
export const SAMPLE_ENCOUNTERS: Record<string, (library: SampleLibrary) => Encounter> = {
  [SAMPLE_ENCOUNTER_ID]: (library) => createSampleEncounter(library.map, library.goblin),
  [SAMPLE_NIGHT_ID]: createNightEncounter,
  [SAMPLE_PREPARED_ID]: createPreparedEncounter,
};
