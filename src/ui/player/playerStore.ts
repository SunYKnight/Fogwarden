import { create } from 'zustand';
import type { BattleMap } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import type { CameraState } from '@/render/CameraRig';
import type { PlayerEncounter, PlayerFog, SyncPayload } from '@/sync/protocol';

interface PlayerState {
  map: BattleMap | null;
  mapRevision: number;
  terrain: HeightField | null;
  encounter: PlayerEncounter | null;
  fog: PlayerFog | null;
  camera: CameraState | null;
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
      case 'hello':
        break;
    }
  },
}));
