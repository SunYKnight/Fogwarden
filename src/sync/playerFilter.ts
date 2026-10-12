import type { BattleMap, Combatant, Encounter } from '@/core/model';
import { FOG_VISIBLE, fogCellAt, type FogCells } from '@/core/vision/fog';
import { currentCombatant } from '@/state/encounterActions';
import type { PlayerCombatant, PlayerEncounter } from './protocol';

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

/** Rough health for creatures whose exact hit points players don't know. */
export function healthBand(hp: Combatant['hp']): NonNullable<PlayerCombatant['health']> {
  return hp.current <= 0 ? 'down' : hp.current >= hp.max ? 'unhurt' : hp.current * 2 <= hp.max ? 'bloodied' : 'hurt';
}

function visibleTo(combatant: Combatant, fog: FogCells | null): boolean {
  const cell = combatant.position && fog ? fogCellAt(combatant.position, fog.size) : -1;
  return cell >= 0 && fog?.cells[cell] === FOG_VISIBLE;
}

function toPlayer(combatant: Combatant): PlayerCombatant {
  const { id, name, side, size, position, facingDeg, conditions, token, visionSource } = combatant;
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
    health: side === 'player' ? null : healthBand(combatant.hp),
  };
}

/**
 * Encounter as players may see it: hidden combatants never, other non-player combatants only while they
 * stand in a currently visible fog cell; markers the DM shares; door states without closed secret doors.
 * `showTurnOrder` is the DM's choice to show the turn order of these combatants.
 */
export function filterEncounterForPlayers(
  encounter: Encounter,
  map: BattleMap | null,
  fog: FogCells | null,
  showTurnOrder = false,
): PlayerEncounter {
  const combatants = encounter.combatants
    .filter((c) => !c.hiddenFromPlayers && (c.side === 'player' || visibleTo(c, fog)))
    .map(toPlayer);
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
    showTurnOrder,
    markers: encounter.markers.filter((m) => m.visibleToPlayers),
    openingStates,
  };
}
