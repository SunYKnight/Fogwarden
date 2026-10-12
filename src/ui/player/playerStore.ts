import { create } from 'zustand';
import type { AssetRef, BattleMap } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import type { CameraState } from '@/render/CameraRig';
import { usePingStore } from '@/state/pingStore';
import type {
  PlayerAudio,
  PlayerEncounter,
  PlayerFog,
  PlayerHandout,
  PlayerInterlude,
  PlayerScene,
  SyncPayload,
} from '@/sync/protocol';

/** Roll results the sheet keeps, newest first. */
const KEPT_ROLLS = 5;

/** A received message with the local clock time it arrived, so positions in it can advance. */
export interface Received<T> {
  value: T;
  atMs: number;
}

interface PlayerState {
  map: BattleMap | null;
  mapRevision: number;
  terrain: HeightField | null;
  encounter: PlayerEncounter | null;
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
  receive(payload: SyncPayload): void;
}

/** Everything the player view knows, built only from messages the DM sent. */
export const usePlayerStore = create<PlayerState>((set, get) => ({
  map: null,
  mapRevision: 0,
  terrain: null,
  encounter: null,
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
        set({ encounter: payload.encounter });
        break;
      case 'fog':
        set({ fog: payload.fog });
        break;
      case 'camera':
        set({ camera: payload.camera });
        break;
      case 'view':
        set({ viewName: payload.name, viewCombatantId: payload.combatantId ?? null });
        break;
      case 'audio':
        set({ audio: { value: payload.audio, atMs: Date.now() } });
        break;
      case 'scene':
        set({ scene: payload.scene });
        break;
      case 'interlude':
        set({ interlude: payload.interlude && { value: payload.interlude, atMs: Date.now() } });
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
      case 'hello':
      case 'roll':
      case 'point':
      case 'move':
        break;
    }
  },
}));
