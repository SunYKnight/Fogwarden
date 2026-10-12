import { z } from 'zod';
import type { CreatureIconKey } from '@/core/creatureTypeIcon';
import type { HandoutKind } from '@/core/handouts';
import {
  PARTY_VIEW,
  type AreaMarker,
  type AssetRef,
  type BattleMap,
  type CarriedLight,
  type Combatant,
  type DeathSaves,
  type MapPoint,
  type OpeningState,
  type Settings,
  type SpeedKind,
  type Weather,
} from '@/core/model';
import type { RollMode } from '@/core/rules/dice';
import type { CameraState } from '@/render/CameraRig';
import { RELAY_VIEW_PATTERN } from './relayApi';

export const SYNC_PROTOCOL_VERSION = 2;

/** Combatant fields players may see; hidden combatants are never sent. */
export type PlayerCombatant = Pick<
  Combatant,
  'id' | 'name' | 'side' | 'size' | 'position' | 'facingDeg' | 'conditions' | 'token' | 'visionSource'
> & {
  /** Rough health band instead of exact hit points for non-player combatants. */
  health: 'unhurt' | 'hurt' | 'bloodied' | 'down' | null;
  /** Creature type icon for a token without picture; absent for ad-hoc combatants, which show initials. */
  typeIcon?: CreatureIconKey;
  /** Torch or lantern the token carries; absent without one. */
  light?: CarriedLight;
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
  /** Only in a player character's view: that character's own sheet. */
  sheet?: PlayerSheet;
  /**
   * Only in a player character's view while the DM lets players move their own token: the diagonal rule for the
   * distance shown while dragging.
   */
  ownMoves?: Settings['diagonalRule'];
}

/** A player character's own numbers, sent only to that character's view. */
export interface PlayerSheet {
  id: string;
  name: string;
  hp: Combatant['hp'];
  armorClass: number;
  /** Feet per movement kind from the library creature; empty for characters entered at the table. */
  speeds: Partial<Record<SpeedKind, number>>;
  conditions: Combatant['conditions'];
  concentrating: boolean;
  /** Only while the character is at 0 hit points. */
  deathSaves: DeathSaves | null;
  /** Spell slots by level from the stat block; levels without slots are left out. */
  slots: { level: number; max: number; used: number }[];
}

/** Picture, video or text the DM shows; text travels inline, pictures and videos as assets. */
export interface PlayerHandout {
  /** New for every show, so a handout the player closed opens again when the DM shows it again. */
  id: string;
  name: string;
  kind: HandoutKind;
  asset: AssetRef | null;
  text: string | null;
}

/** Music the players hear; `positionSec` is where the track stood when the message was sent. */
export interface PlayerMusic {
  asset: AssetRef;
  positionSec: number;
  playing: boolean;
}

/** Music and the DM's master volume (0..1) for music, effects and ambience. */
export interface PlayerAudio {
  music: PlayerMusic | null;
  volume: number;
}

/** Time of day (minute 0..1439, null = the map's own light) and weather of the scene. */
export interface PlayerScene {
  minute: number | null;
  weather: Weather;
}

/** Fullscreen video for the players; `positionSec` lets late joiners catch up. */
export interface PlayerInterlude {
  asset: AssetRef;
  positionSec: number;
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
  /**
   * Whose eyes the receiver sees through: a player character's name or "Party"; `combatantId` is that
   * character's id, null for the party.
   */
  | { type: 'view'; name: string; combatantId?: string | null }
  /** Player rolls for their character; the DM rolls, logs and answers with `rolled`. */
  | { type: 'roll'; dice: string; mode: RollMode; label: string }
  /** Player points at a spot of the map. */
  | { type: 'point'; at: MapPoint }
  /** Player asks to move their own token; the DM applies it with the movement rules. */
  | { type: 'move'; combatantId: string; to: MapPoint }
  /** The DM's result of this view's roll, as written into the log. */
  | { type: 'rolled'; text: string }
  /** Someone pointed at a spot this view can see. */
  | { type: 'ping'; at: MapPoint; by: string }
  /** Handout to show over the map; null hides it. */
  | { type: 'handout'; handout: PlayerHandout | null }
  /** Music and master volume; sent on every change. */
  | { type: 'audio'; audio: PlayerAudio }
  /** One-shot sound effect at `volume` (0..1) of the master volume. */
  | { type: 'sfx'; asset: AssetRef; volume: number }
  | { type: 'scene'; scene: PlayerScene | null }
  /** Fullscreen interlude video; null ends it. */
  | { type: 'interlude'; interlude: PlayerInterlude | null };

/** What players send besides `hello`; the DM gets each one with the view of the link it came over. */
export type PlayerRequest = Extract<SyncPayload, { type: 'roll' | 'point' | 'move' }>;

export interface SyncMessage {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  from: 'dm' | 'player';
  payload: SyncPayload;
}

// Far beyond any map; keeps forged numbers out of the DM's geometry.
const MAX_COORDINATE_FT = 1_000_000;
const coordinate = z.number().min(-MAX_COORDINATE_FT).max(MAX_COORDINATE_FT);
const pointSchema = z.strictObject({ x: coordinate, y: coordinate, elevationFt: coordinate });

/** Dice text as typed; the DM parses it with `parseDice`. */
export const PLAYER_DICE_PATTERN = /^[0-9dD+\- ]{1,40}$/;
export const PLAYER_LABEL_MAX = 40;

/**
 * Every message a player may send. Any protocol number passes, so a relay deployed once keeps working when the
 * app bumps the protocol; strict objects reject smuggled extra fields.
 */
export const playerMessageSchema = z.strictObject({
  protocol: z.number().int().nonnegative(),
  from: z.literal('player'),
  payload: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('hello') }),
    z.strictObject({
      type: z.literal('roll'),
      dice: z.string().regex(PLAYER_DICE_PATTERN),
      mode: z.enum(['normal', 'advantage', 'disadvantage']),
      label: z.string().max(PLAYER_LABEL_MAX),
    }),
    z.strictObject({ type: z.literal('point'), at: pointSchema }),
    z.strictObject({ type: z.literal('move'), combatantId: z.string().regex(RELAY_VIEW_PATTERN), to: pointSchema }),
  ]),
});

// Party screens have no sheet to roll for and no token of their own.
const CHARACTER_ONLY: Record<z.infer<typeof playerMessageSchema>['payload']['type'], boolean> = {
  hello: false,
  roll: true,
  point: false,
  move: true,
};

/**
 * A player's message as the LAN server and the relay forward it to the DM: rebuilt from the validated fields
 * only, so the DM never sees smuggled data. Rolls and moves need a character's view, and a move only names the
 * view's own token. Null for anything else; `rebuild_player_message` in `src-tauri/src/lan.rs` mirrors it.
 */
export function rebuildPlayerMessage(text: string, view: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Malformed JSON is one more kind of invalid player message.
    parsed = undefined;
  }
  const result = playerMessageSchema.safeParse(parsed);
  const message = result.success ? result.data : null;
  const payload = message?.payload;
  const allowed =
    payload !== undefined &&
    !(CHARACTER_ONLY[payload.type] && view === PARTY_VIEW) &&
    (payload.type !== 'move' || payload.combatantId === view);
  return allowed ? JSON.stringify({ protocol: message!.protocol, from: 'player', payload }) : null;
}

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
  /** Calls `handler` with every player request and the view of the receiver that sent it. */
  onPlayerRequest(handler: (view: string, request: PlayerRequest) => void): () => void;
  /** Calls `handler` with the views that have receivers: now and on every change. */
  watchViews(handler: (views: ReadonlySet<string>) => void): () => void;
}
