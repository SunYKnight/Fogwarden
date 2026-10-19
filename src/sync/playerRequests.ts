import {
  CHAT_EVERYONE,
  CHAT_TO_DM,
  PARTY_VIEW,
  type BattleMap,
  type Combatant,
  type Encounter,
  type MapPoint,
  type Settings,
  type Vec2,
} from '@/core/model';
import { rollDice } from '@/core/rules/dice';
import { gridDistanceFt } from '@/core/rules/distance';
import type { HeightField } from '@/core/terrain/heightfield';
import { FOG_UNKNOWN, fogCellAt, type FogCells } from '@/core/vision/fog';
import { snapTokenPoint } from '@/render/tokens/tokenPlacement';
import { useAppStore } from '@/state/appStore';
import { addLog, describeRoll } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { usePingStore } from '@/state/pingStore';
import { appendChat, chatLine } from './chat';
import { storePlayerNotes } from './playerData';
import type { PlayerRequest, SyncPayload } from './protocol';
import { handleSheetEdit } from './sheetEdits';
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

type Reply = (payload: SyncPayload) => void;

/** Tells the DM and the player why a request was not carried out. */
function refuse(what: string, why: string, reply: Reply): void {
  useAppStore.getState().notify(`A player's ${what} was refused: ${why}`, 'info');
  reply({ type: 'notice', text: `Not done: ${why}` });
}

function applyChat(view: string, name: string, request: Extract<PlayerRequest, { type: 'chat' }>, reply: Reply) {
  const { encounter, update } = useEncounterStore.getState();
  const text = request.text.trim();
  const refused = !useViewLinksStore.getState().features.chat
    ? 'the campaign has no chat'
    : view === PARTY_VIEW
      ? 'the party view cannot chat'
      : !encounter
        ? 'no encounter is open'
        : null;
  if (refused !== null) {
    refuse('chat line', refused, reply);
  } else if (text !== '') {
    const to = request.to === 'dm' ? CHAT_TO_DM : CHAT_EVERYONE;
    update((d) => appendChat(d, chatLine(view, name, to, 'say', text)));
  }
}

function applyNote(view: string, request: Extract<PlayerRequest, { type: 'note' }>, reply: Reply) {
  const { features, campaignId, linked } = useViewLinksStore.getState();
  const linkedCharacter = view !== PARTY_VIEW && linked.some((v) => v.id === view);
  if (!features.playerNotes || campaignId === null || !linkedCharacter) {
    const why = !features.playerNotes ? 'the campaign keeps no player notes' : 'the view keeps no notes';
    refuse('note', why, reply);
  } else {
    storePlayerNotes(campaignId, view, request.text).catch(useAppStore.getState().reportError);
  }
}

/**
 * Carries out what a player asked for over the link of `view`: a roll goes into the log and back to that view
 * as `rolled` (and, shared while the campaign allows it, into the chat for every character view), a point
 * becomes a ping, a move is applied as one undo step, chat lines and notes are kept, sheet edits go to
 * `handleSheetEdit`. Refusals reach the DM and the view as a notice. Throws when a roll cannot be made.
 */
export function handlePlayerRequest(view: string, request: PlayerRequest, reply: Reply): void {
  const name = useViewLinksStore.getState().linked.find((v) => v.id === view)?.name ?? view;
  switch (request.type) {
    case 'point':
      usePingStore.getState().add({ at: request.at, by: name, from: view });
      break;
    case 'roll': {
      const text = rollText(name, request);
      const shared = request.share === true && useViewLinksStore.getState().features.sharedRolls;
      useEncounterStore.getState().update((d) => {
        addLog(d, 'roll', text);
        if (shared) appendChat(d, chatLine(view, name, CHAT_EVERYONE, 'roll', text));
      });
      reply({ type: 'rolled', text });
      break;
    }
    case 'move':
      applyMove(view, request);
      break;
    case 'chat':
      applyChat(view, name, request, reply);
      break;
    case 'note':
      applyNote(view, request, reply);
      break;
    case 'sheetEdit':
      handleSheetEdit(view, request, reply);
      break;
  }
}
