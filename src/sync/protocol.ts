import { z } from 'zod';
import type { AreaMarker, BattleMap, Combatant, OpeningState } from '@/core/model';
import type { CameraState } from '@/render/CameraRig';

export const SYNC_PROTOCOL_VERSION = 2;

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
  /** The DM's token style for the 3D view: upright picture cards or discs. */
  standees: boolean;
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
  | { type: 'camera'; camera: CameraState | null }
  /** Whose eyes the receiver sees through: a player character's name or "Party". */
  | { type: 'view'; name: string };

export interface SyncMessage {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  from: 'dm' | 'player';
  payload: SyncPayload;
}

/**
 * The only message a relay forwards from a player. Any protocol number passes, so a relay deployed once keeps
 * working when the app bumps the protocol; strict objects reject smuggled extra fields.
 */
export const playerHelloSchema = z.strictObject({
  protocol: z.number().int().nonnegative(),
  from: z.literal('player'),
  payload: z.strictObject({ type: z.literal('hello') }),
});

export interface SyncTransport {
  send(payload: SyncPayload): void;
  /** Calls `handler` for messages sent by the other side only. */
  subscribe(handler: (payload: SyncPayload) => void): () => void;
  close(): void;
}

/**
 * DM side of a link to player views (`PARTY_VIEW` or a player character's combatant id): every view gets only
 * its own messages.
 */
export interface DmTransport {
  /** Sends `payload` to the receivers of `views`; views without receivers on this transport are skipped. */
  send(views: readonly string[], payload: SyncPayload): void;
  /**
   * Calls `handler` with a view whose receivers need everything again (a player's hello), or with null when all
   * receivers of this transport do (the transport itself reconnected).
   */
  onResend(handler: (view: string | null) => void): () => void;
  /** Calls `handler` with the views that have receivers: now and on every change. */
  watchViews(handler: (views: ReadonlySet<string>) => void): () => void;
}
