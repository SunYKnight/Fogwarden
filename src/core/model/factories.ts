import { newId, nowIso, type DocRef } from './common';
import { CREATURE_SCHEMA_VERSION, type Creature } from './creature';
import {
  CAMPAIGN_SCHEMA_VERSION,
  defaultAtmosphere,
  ENCOUNTER_SCHEMA_VERSION,
  type Campaign,
  type Encounter,
} from './encounter';
import { MAP_SCHEMA_VERSION, type BattleMap, type MapImage } from './map';
import { MARKER_SCHEMA_VERSION, type MarkerTemplate } from './marker';
import { HeightField } from '../terrain/heightfield';

const DEFAULT_SAMPLES_PER_SQUARE = 4;

function header<S extends string>(schema: S, version: number, name: string) {
  const at = nowIso();
  return { schema, version, id: newId(), name, createdAt: at, updatedAt: at };
}

export function createMap(options: {
  name: string;
  image: MapImage | null;
  squaresX: number;
  squaresY: number;
  pxPerSquare: number;
}): BattleMap {
  const grid = {
    feetPerSquare: 5,
    pxPerSquare: options.pxPerSquare,
    offsetPx: { x: 0, y: 0 },
    rotationDeg: 0,
    squaresX: options.squaresX,
    squaresY: options.squaresY,
    show: true,
    color: '#000000',
    opacity: 0.35,
  };
  return {
    ...header('map', MAP_SCHEMA_VERSION, options.name),
    tags: [],
    notes: '',
    image: options.image,
    grid,
    terrain: {
      samplesPerSquare: DEFAULT_SAMPLES_PER_SQUARE,
      heights: HeightField.empty(grid, DEFAULT_SAMPLES_PER_SQUARE).encode(),
      baseColor: '#5d6b3a',
      cliffMaterial: 'rock',
      cliffSlopeDeg: 55,
    },
    ambientLight: 'bright',
    walls: [],
    openings: [],
    rooms: [],
    regions: [],
    lights: [],
    props: [],
  };
}

export function createCreature(name: string): Creature {
  return {
    ...header('creature', CREATURE_SCHEMA_VERSION, name),
    kind: 'monster',
    source: 'Custom',
    license: '',
    tags: [],
    size: 'medium',
    type: 'humanoid',
    subtype: '',
    alignmentText: 'unaligned',
    alignmentWeights: { unaligned: 1 },
    armorClass: 10,
    armorNote: '',
    hitPoints: { average: 4, formula: '1d8' },
    speeds: { walk: 30 },
    hover: false,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    savingThrows: {},
    skills: {},
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    senses: {},
    passivePerception: 10,
    languages: [],
    challenge: 0,
    xp: 0,
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryDescription: '',
    legendaryActions: [],
    image: null,
    token: null,
    notes: '',
  };
}

export function createMarkerTemplate(name: string): MarkerTemplate {
  return {
    ...header('marker', MARKER_SCHEMA_VERSION, name),
    shape: 'sphere',
    sizeFt: 20,
    widthFt: 5,
    heightFt: 20,
    color: '#ff6600',
    opacity: 0.35,
    notes: '',
  };
}

export function createCampaign(name: string): Campaign {
  return { ...header('campaign', CAMPAIGN_SCHEMA_VERSION, name), notes: '' };
}

export function createEncounter(name: string, campaignId: string, map: DocRef | null): Encounter {
  return {
    ...header('encounter', ENCOUNTER_SCHEMA_VERSION, name),
    campaignId,
    map,
    round: 0,
    turnIndex: 0,
    combatants: [],
    markers: [],
    openingStates: {},
    fog: { cellsPerSquare: 2, exploredBy: {}, revealedByDm: '', hiddenByDm: '' },
    log: [],
    notes: '',
    atmosphere: defaultAtmosphere(),
    playersMoveTokens: false,
  };
}
