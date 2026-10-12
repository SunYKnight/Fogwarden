import type { AreaMarker, BattleMap, Combatant, OpeningState } from '@/core/model';
import type { CameraState } from '@/render/CameraRig';

export const SYNC_PROTOCOL_VERSION = 1;

/** Combatant fields players may see; hidden combatants are never sent. */
export type PlayerCombatant = Pick<
  Combatant,
  'id' | 'name' | 'side' | 'size' | 'position' | 'facingDeg' | 'conditions' | 'token' | 'visionSource'
> & {
  /** Rough health band instead of exact hit points for non-player combatants. */
  health: 'unhurt' | 'hurt' | 'bloodied' | 'down' | null;
};

export interface PlayerEncounter {
  encounterId: string;
  round: number;
  activeCombatantId: string | null;
  /** In turn order. */
  combatants: PlayerCombatant[];
  /** The DM lets players see the turn order as an initiative ribbon. */
  showTurnOrder: boolean;
  markers: AreaMarker[];
  openingStates: Record<string, OpeningState>;
}

/** Per-cell visibility for the whole map, row-major from the north-west corner, one byte per cell. */
export interface PlayerFog {
  cellsX: number;
  cellsY: number;
  /** Base64 of Uint8Array with FOG_UNKNOWN / FOG_EXPLORED / FOG_VISIBLE values. */
  cells: string;
}

export type SyncPayload =
  /** Player asks the DM for a full resend (on connect or reconnect). */
  | { type: 'hello' }
  /** Map stripped of DM-only data (secret doors, hidden regions, notes); null clears the view. */
  | { type: 'map'; revision: number; map: BattleMap | null }
  | { type: 'encounter'; encounter: PlayerEncounter | null }
  | { type: 'fog'; fog: PlayerFog | null }
  | { type: 'camera'; camera: CameraState | null };

export interface SyncMessage {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  from: 'dm' | 'player';
  payload: SyncPayload;
}

export interface SyncTransport {
  send(payload: SyncPayload): void;
  /** Calls `handler` for messages sent by the other side only. */
  subscribe(handler: (payload: SyncPayload) => void): () => void;
  close(): void;
}
