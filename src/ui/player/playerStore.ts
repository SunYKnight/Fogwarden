import { create } from 'zustand';
import { CHAT_MAX_LINES, type AssetRef, type BattleMap, type SheetEdit } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import type { CameraState } from '@/render/CameraRig';
import { usePingStore } from '@/state/pingStore';
import type {
  CharacterDetails,
  PlayerAudio,
  PlayerChatLine,
  PlayerEncounter,
  PlayerFog,
  PlayerHandout,
  PlayerInterlude,
  PlayerScene,
  SyncPayload,
} from '@/sync/protocol';
import { addWaitingEdit, settleWaitingEdit, type WaitingEdits } from './waitingEdits';

/** Roll results the sheet keeps, newest first. */
const KEPT_ROLLS = 5;

/** A received message with the local clock time it arrived, so positions in it can advance. */
interface Received<T> {
  value: T;
  atMs: number;
}

/** Full sheet content of this view's character as of `revision`. */
export interface ReceivedDetails {
  id: string;
  revision: number;
  content: CharacterDetails;
}

/** New sheet content, else the kept one while the character and its revision stay the same. */
function receivedDetails(kept: ReceivedDetails | null, encounter: PlayerEncounter | null): ReceivedDetails | null {
  const sheet = encounter?.sheet;
  const details = sheet?.details;
  return sheet && details?.content
    ? { id: sheet.id, revision: details.revision, content: details.content }
    : kept && sheet && kept.id === sheet.id && kept.revision === details?.revision
      ? kept
      : null;
}

interface PlayerState {
  map: BattleMap | null;
  mapRevision: number;
  terrain: HeightField | null;
  encounter: PlayerEncounter | null;
  /** The character's full sheet, kept across encounter messages that carry only its revision. */
  details: ReceivedDetails | null;
  fog: PlayerFog | null;
  camera: CameraState | null;
  /** Whose eyes this screen sees through, e.g. "Party"; null until the DM says. */
  viewName: string | null;
  /** The viewing character's combatant id; null in the party view or until the DM says. */
  viewCombatantId: string | null;
  audio: Received<PlayerAudio> | null;
  scene: PlayerScene | null;
  interlude: Received<PlayerInterlude> | null;
  /** Last sound board effect; `seq` tells repeats of the same effect apart. */
  effect: { asset: AssetRef; volume: number; seq: number } | null;
  /** The DM's answers to this view's rolls, newest first. */
  rolls: string[];
  /** What the DM shows this view over the map. */
  handout: PlayerHandout | null;
  /** Chat lines this view may read, oldest first. */
  chat: PlayerChatLine[];
  /** Lines that arrived since the chat was last opened. */
  chatUnread: number;
  /** The character's notes as the DM stored them; null until the DM sends them. */
  notes: string | null;
  /** Latest news from the DM app; `seq` tells repeats of the same text apart. */
  notice: { text: string; seq: number } | null;
  /** The character's sheet edits the DM has not answered for good ('approve' mode). */
  waitingEdits: WaitingEdits;
  receive(payload: SyncPayload): void;
  markChatRead(): void;
  /** Notes `edit`, sent while the sheet showed `confirmed` (the same value as an edit), as waiting for the DM. */
  waitForEdit(edit: SheetEdit, confirmed: SheetEdit): void;
}

/** Everything the player view knows, built only from messages the DM sent. */
export const usePlayerStore = create<PlayerState>((set, get) => ({
  map: null,
  mapRevision: 0,
  terrain: null,
  encounter: null,
  details: null,
  fog: null,
  camera: null,
  viewName: null,
  viewCombatantId: null,
  audio: null,
  scene: null,
  interlude: null,
  effect: null,
  rolls: [],
  handout: null,
  chat: [],
  chatUnread: 0,
  notes: null,
  notice: null,
  waitingEdits: {},
  markChatRead: () => set({ chatUnread: 0 }),
  waitForEdit: (edit, confirmed) => set({ waitingEdits: addWaitingEdit(get().waitingEdits, edit, confirmed) }),
  receive: (payload) => {
    switch (payload.type) {
      case 'map':
        // Resends for other player windows repeat a revision built here.
        if (payload.revision !== get().mapRevision) {
          set({
            map: payload.map,
            mapRevision: payload.revision,
            terrain: payload.map ? HeightField.fromMap(payload.map) : null,
          });
        }
        break;
      case 'encounter':
        set({ encounter: payload.encounter, details: receivedDetails(get().details, payload.encounter) });
        break;
      case 'fog':
        set({ fog: payload.fog });
        break;
      case 'camera':
        set({ camera: payload.camera });
        break;
      case 'view': {
        const viewCombatantId = payload.combatantId ?? null;
        // Edits of another character are not this sheet's.
        const waitingEdits = viewCombatantId === get().viewCombatantId ? get().waitingEdits : {};
        set({ viewName: payload.name, viewCombatantId, waitingEdits });
        break;
      }
      case 'audio':
        set({ audio: { value: payload.audio, atMs: Date.now() } });
        break;
      case 'scene':
        set({ scene: payload.scene });
        break;
      case 'interlude':
        // Resends for another device of this view repeat the running video.
        if (payload.interlude?.id !== get().interlude?.value.id) {
          set({ interlude: payload.interlude && { value: payload.interlude, atMs: Date.now() } });
        }
        break;
      case 'sfx':
        set({ effect: { asset: payload.asset, volume: payload.volume, seq: (get().effect?.seq ?? 0) + 1 } });
        break;
      case 'rolled':
        set({ rolls: [payload.text, ...get().rolls].slice(0, KEPT_ROLLS) });
        break;
      case 'ping':
        usePingStore.getState().add({ at: payload.at, by: payload.by, from: null });
        break;
      case 'handout':
        set({ handout: payload.handout });
        break;
      case 'chatLines': {
        const kept = payload.reset ? [] : get().chat;
        const unread = payload.reset ? 0 : get().chatUnread + payload.lines.length;
        set({ chat: [...kept, ...payload.lines].slice(-CHAT_MAX_LINES), chatUnread: unread });
        break;
      }
      case 'notes':
        set({ notes: payload.text });
        break;
      case 'notice': {
        const { waitingEdits } = get();
        set({
          notice: { text: payload.text, seq: (get().notice?.seq ?? 0) + 1 },
          waitingEdits: payload.settles ? settleWaitingEdit(waitingEdits, payload.settles) : waitingEdits,
        });
        break;
      }
      case 'hello':
      case 'roll':
      case 'point':
      case 'move':
      case 'chat':
      case 'note':
      case 'sheetEdit':
        break;
    }
  },
}));
