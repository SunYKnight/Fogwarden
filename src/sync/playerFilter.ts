import type { CreatureIconKey } from '@/core/creatureTypeIcon';
import type { AssetRef, BattleMap, Combatant, Creature, Encounter } from '@/core/model';
import { CREATURE_SPACE_FT } from '@/core/rules/space';
import { creatureResources } from '@/core/rules/resources';
import { cellRange, FOG_VISIBLE, type FogCells } from '@/core/vision/fog';
import { currentCombatant } from '@/state/encounterActions';
import type { PlayerCombatant, PlayerEncounter, PlayerSheet } from './protocol';

/** Secret openings players know about: only those standing open right now. */
function openSecretIds(map: BattleMap, encounter: Encounter): Set<string> {
  return new Set(
    map.openings.filter((o) => o.secret && (encounter.openingStates[o.id] ?? o.state) === 'open').map((o) => o.id),
  );
}

/** Everything of the encounter the filtered map depends on; the map is resent only when this changes. */
export function playerMapInputs(map: BattleMap, encounter: Encounter): string {
  const hidden = encounter.combatants.filter((c) => c.hiddenFromPlayers).map((c) => c.id);
  return JSON.stringify([[...openSecretIds(map, encounter)], hidden]);
}

/**
 * Map as players may see it: closed secret doors vanish into their wall (an opened one becomes a plain
 * door), hidden regions and lights carried by hidden combatants are removed, notes are cleared.
 * Hidden regions still shape the fog, which the DM computes.
 */
export function filterMapForPlayers(map: BattleMap, encounter: Encounter): BattleMap {
  const openSecrets = openSecretIds(map, encounter);
  const hidden = new Set(encounter.combatants.filter((c) => c.hiddenFromPlayers).map((c) => c.id));
  return {
    ...map,
    notes: '',
    openings: map.openings.filter((o) => !o.secret || openSecrets.has(o.id)).map((o) => ({ ...o, secret: false })),
    regions: map.regions.filter((r) => !r.hiddenFromPlayers).map((r) => ({ ...r, notes: '' })),
    lights: map.lights.filter((l) => l.attachedTo === null || !hidden.has(l.attachedTo)),
  };
}

/** Rough health in thirds of the maximum, which players see as the colour of a token's name tag. */
export function healthBand(hp: Combatant['hp']): PlayerCombatant['health'] {
  const third = hp.max / 3;
  return hp.current <= 0 ? 'down' : hp.current < third ? 'critical' : hp.current < 2 * third ? 'wounded' : 'healthy';
}

// Keeps a footprint edge that lies on a cell border from reaching into the
// neighbouring cell.
const EDGE_FT = 0.01;

/** Players see a creature when any fog cell of the space it occupies is visible, as 5e line of sight works. */
function visibleTo(combatant: Combatant, fog: FogCells | null): boolean {
  const { position } = combatant;
  const half = CREATURE_SPACE_FT[combatant.size] / 2 - EDGE_FT;
  const cells = fog?.cells ?? new Uint8Array();
  const cellsX = fog?.size.cellsX ?? 0;
  const range =
    position && fog
      ? cellRange(fog.size, position.x - half, position.y - half, position.x + half, position.y + half)
      : { col0: 0, col1: -1, row0: 0, row1: -1 };
  let seen = false;
  for (let row = range.row0; row <= range.row1; row++) {
    for (let col = range.col0; col <= range.col1; col++) {
      seen = seen || cells[row * cellsX + col] === FOG_VISIBLE;
    }
  }
  return seen;
}

function toPlayer(combatant: Combatant, token: AssetRef | null, typeIcon: CreatureIconKey | null): PlayerCombatant {
  const { id, name, side, size, position, facingDeg, conditions, visionSource } = combatant;
  return {
    id,
    name,
    side,
    size,
    position,
    facingDeg,
    conditions,
    token,
    visionSource,
    health: healthBand(combatant.hp),
    ...(typeIcon ? { typeIcon } : {}),
    ...(combatant.light ? { light: combatant.light } : {}),
  };
}

export interface PlayerViewOptions {
  /** The DM's choice to show the turn order of the sent combatants. */
  showTurnOrder: boolean;
  standees: boolean;
  /** Token picture of a combatant; the DM side resolves creature pictures and portraits here. */
  tokenOf: (combatant: Combatant) => AssetRef | null;
  /** Type icon of a combatant's library creature; null for ad-hoc combatants. */
  typeIconOf: (combatant: Combatant) => CreatureIconKey | null;
}

const PLAIN_VIEW: PlayerViewOptions = {
  showTurnOrder: false,
  standees: true,
  tokenOf: (c) => c.token,
  typeIconOf: () => null,
};

/**
 * Encounter as players may see it: hidden combatants never, other non-player combatants only while players
 * see a fog cell of the space they occupy; markers the DM shares; door states without closed secret doors.
 */
export function filterEncounterForPlayers(
  encounter: Encounter,
  map: BattleMap | null,
  fog: FogCells | null,
  view: PlayerViewOptions = PLAIN_VIEW,
): PlayerEncounter {
  const combatants = encounter.combatants
    .filter((c) => !c.hiddenFromPlayers && (c.side === 'player' || visibleTo(c, fog)))
    .map((c) => toPlayer(c, view.tokenOf(c), view.typeIconOf(c)));
  const active = currentCombatant(encounter);
  const secret = new Set(map?.openings.filter((o) => o.secret).map((o) => o.id) ?? []);
  const openingStates = Object.fromEntries(
    Object.entries(encounter.openingStates).filter(([id, state]) => !secret.has(id) || state === 'open'),
  );
  return {
    encounterId: encounter.id,
    round: encounter.round,
    activeCombatantId: active && combatants.some((c) => c.id === active.id) ? active.id : null,
    combatants,
    showTurnOrder: view.showTurnOrder,
    standees: view.standees,
    markers: encounter.markers.filter((m) => m.visibleToPlayers),
    openingStates,
  };
}

/** A player character's own sheet for its view; speeds and spell slots come from its library creature. */
export function playerSheet(combatant: Combatant, creature: Creature | null): PlayerSheet {
  const slots = creature ? creatureResources(creature).slots : {};
  return {
    id: combatant.id,
    name: combatant.name,
    hp: combatant.hp,
    armorClass: combatant.armorClass,
    speeds: creature?.speeds ?? {},
    conditions: combatant.conditions,
    concentrating: combatant.concentrating,
    deathSaves: combatant.hp.current <= 0 ? combatant.deathSaves : null,
    slots: Object.entries(slots)
      .map(([level, max]) => ({ level: Number(level), max, used: combatant.resources.slotsUsed[level] ?? 0 }))
      .sort((a, b) => a.level - b.level),
  };
}
