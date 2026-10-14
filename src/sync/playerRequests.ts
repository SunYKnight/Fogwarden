import type { BattleMap, Combatant, Encounter, MapPoint, Settings, Vec2 } from '@/core/model';
import { rollDice } from '@/core/rules/dice';
import { gridDistanceFt } from '@/core/rules/distance';
import type { HeightField } from '@/core/terrain/heightfield';
import { FOG_UNKNOWN, fogCellAt, type FogCells } from '@/core/vision/fog';
import { snapTokenPoint } from '@/render/tokens/tokenPlacement';
import { useAppStore } from '@/state/appStore';
import { addLog, describeRoll } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { usePingStore } from '@/state/pingStore';
import type { PlayerRequest, SyncPayload } from './protocol';
import { useViewLinksStore } from './views';

/**
 * Views that see a ping at `at`: the view that pointed (`from`, null for the DM) and every view whose fog shows
 * that spot, explored or in sight. Without fog every view sees the whole map.
 */
export function pingAudience(
  at: Vec2,
  from: string | null,
  views: readonly string[],
  fogOf: (view: string) => FogCells | null,
): string[] {
  return views.filter((view) => {
    const fog = view === from ? null : fogOf(view);
    const cell = fog ? fogCellAt(at, fog.size) : -1;
    return fog === null || (cell >= 0 && fog.cells[cell] !== FOG_UNKNOWN);
  });
}

export interface MoveRules {
  encounter: Encounter;
  map: BattleMap | null;
  terrain: HeightField | null;
  diagonalRule: Settings['diagonalRule'];
}

export type MoveCheck = { combatant: Combatant; to: MapPoint; feet: number } | { refused: string };

/**
 * A player's request to move their token, checked like a DM drag: only with the encounter's permission, only the
 * view's own placed and visible character, snapped to whole squares with its height above the ground kept, and
 * the distance by the grid rule.
 */
export function checkPlayerMove(
  rules: MoveRules,
  view: string,
  request: Extract<PlayerRequest, { type: 'move' }>,
): MoveCheck {
  const { encounter, map, terrain, diagonalRule } = rules;
  const combatant = encounter.combatants.find((c) => c.id === request.combatantId);
  const from = combatant?.position;
  const refusals: [boolean, string][] = [
    [!encounter.playersMoveTokens, 'players may not move their tokens in this encounter'],
    [request.combatantId !== view, 'that token belongs to another view'],
    [combatant?.side !== 'player', 'that token is not a player character'],
    [combatant?.hiddenFromPlayers === true, 'the token is hidden from the players'],
    [!from, 'the token is not on the map'],
    [!map || !terrain, 'the encounter has no map'],
  ];
  const refused = refusals.find(([fails]) => fails)?.[1];
  let check: MoveCheck = { refused: refused ?? 'the move is not possible' };
  if (refused === undefined && combatant && from && map && terrain) {
    const snapped = snapTokenPoint(request.to, combatant.size, map.grid, terrain);
    const aboveGround = from.elevationFt - terrain.sample(from.x, from.y);
    const to = { ...snapped, elevationFt: snapped.elevationFt + aboveGround };
    check = { combatant, to, feet: gridDistanceFt(from, to, map.grid, diagonalRule) };
  }
  return check;
}

function rollText(name: string, request: Extract<PlayerRequest, { type: 'roll' }>): string {
  const roll = rollDice(request.dice, { mode: request.mode });
  const label = request.label.trim() === '' ? '' : `${request.label.trim()} `;
  const mode = request.mode === 'normal' ? '' : ` with ${request.mode}`;
  return `${name} rolls ${label}${roll.expression}${mode}: ${describeRoll(roll)}`;
}

function applyMove(view: string, request: Extract<PlayerRequest, { type: 'move' }>): void {
  const { encounter, map, terrain, update } = useEncounterStore.getState();
  const { settings, notify } = useAppStore.getState();
  const diagonalRule = settings?.diagonalRule ?? '5-5-5';
  const check: MoveCheck = encounter
    ? checkPlayerMove({ encounter, map, terrain, diagonalRule }, view, request)
    : { refused: 'no encounter is open' };
  if ('refused' in check) {
    notify(`A player's move was refused: ${check.refused}`, 'info');
  } else if (check.feet > 0) {
    const { combatant, to, feet } = check;
    update((d) => {
      d.combatants.find((c) => c.id === combatant.id)!.position = to;
      addLog(d, 'note', `${combatant.name} moved ${feet} ft (player)`);
    }, `Move ${combatant.name}`);
  }
}

/**
 * Carries out what a player asked for over the link of `view`: a roll goes into the log and back to that view
 * as `rolled`, a point becomes a ping, a move is applied as one undo step. Throws when a roll cannot be made.
 */
export function handlePlayerRequest(view: string, request: PlayerRequest, reply: (payload: SyncPayload) => void): void {
  const name = useViewLinksStore.getState().linked.find((v) => v.id === view)?.name ?? view;
  switch (request.type) {
    case 'point':
      usePingStore.getState().add({ at: request.at, by: name, from: view });
      break;
    case 'roll': {
      const text = rollText(name, request);
      useEncounterStore.getState().update((d) => addLog(d, 'roll', text));
      reply({ type: 'rolled', text });
      break;
    }
    case 'move':
      applyMove(view, request);
      break;
  }
}
