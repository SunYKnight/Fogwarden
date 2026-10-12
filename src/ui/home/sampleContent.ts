import {
  createCampaign,
  createEncounter,
  type BattleMap,
  type Campaign,
  type Creature,
  type DocRef,
  type Encounter,
} from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { createPc, spawnCombatant } from '@/state/encounterActions';

/** Shipped sample map built by `tools/build-sample.ts`. */
export const SAMPLE_MAP: DocRef = { area: 'content', id: 'sample-chapel' };
export const SAMPLE_GOBLIN: DocRef = { area: 'content', id: 'srd-goblin' };
// Stable ids let "Open the sample encounter" find what it created earlier.
export const SAMPLE_CAMPAIGN_ID = 'sample-campaign';
export const SAMPLE_ENCOUNTER_ID = 'sample-goblin-ambush';

/** Squares (column, row) matching the drawing: campfire, altar, breach. */
const GOBLIN_SQUARES: [number, number][] = [
  [14, 12],
  [16, 11],
  [10, 5],
  [14, 7],
];

/** Example party on the path south of the chapel. */
const PCS = [
  { name: 'Thorin (dwarf fighter)', level: 3, armorClass: 18, maxHp: 28, senses: { darkvision: 60 }, square: [9, 14] },
  { name: 'Elara (human cleric)', level: 3, armorClass: 16, maxHp: 24, senses: {}, square: [10, 15] },
] as const;

export function createSampleCampaign(): Campaign {
  return { ...createCampaign('Sample campaign'), id: SAMPLE_CAMPAIGN_ID };
}

/** Four SRD goblins and two example PCs placed on square centers at terrain height. */
export function createSampleEncounter(map: BattleMap, goblin: Creature): Encounter {
  const terrain = HeightField.fromMap(map);
  const fps = map.grid.feetPerSquare;
  const at = ([col, row]: readonly [number, number]) => {
    const x = (col + 0.5) * fps;
    const y = (row + 0.5) * fps;
    return { x, y, elevationFt: terrain.sample(x, y) };
  };
  const encounter = createEncounter('Goblin ambush at the chapel', SAMPLE_CAMPAIGN_ID, SAMPLE_MAP);
  const goblins = GOBLIN_SQUARES.reduce<Encounter['combatants']>((list, square) => {
    const spawned = spawnCombatant(goblin, SAMPLE_GOBLIN, {
      hpMode: 'average',
      side: 'enemy',
      takenNames: list.map((c) => c.name),
    });
    return [...list, { ...spawned, position: at(square) }];
  }, []);
  const party = PCS.map((pc) => ({
    ...createPc({ ...pc, senses: { ...pc.senses }, visionSource: true }),
    position: at(pc.square),
  }));
  return { ...encounter, id: SAMPLE_ENCOUNTER_ID, combatants: [...party, ...goblins] };
}
