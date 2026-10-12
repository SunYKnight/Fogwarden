import { bytesToBase64 } from '@/core/binary';
import type { BattleMap } from '@/core/model';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useDmCameraStore } from './cameraStore';
import { filterEncounterForPlayers, filterMapForPlayers, playerMapInputs } from './playerFilter';
import type { PlayerFog, SyncPayload, SyncTransport } from './protocol';

// Unique across restarts: players skip a map revision they already have.
let mapRevision = Date.now();

/**
 * Sends the open encounter to the player views, filtered on the DM side: the map when it or its
 * player-relevant encounter inputs change, the player encounter and fog when their content changes, and
 * the DM camera while 'push camera' is on. Every start and every `hello` sends the full state to all
 * transports. The transports stay open when the publisher stops; their owners close them.
 */
export function startDmPublisher(transports: SyncTransport[]): () => void {
  let source: { map: BattleMap | null; inputs: string } = { map: null, inputs: '' };
  let playerMap: BattleMap | null = null;
  let sentEncounter = '';
  let sentFog = '';
  let pushing = false;

  const send = (payload: SyncPayload) => {
    for (const transport of transports) {
      transport.send(payload);
    }
  };

  const publishMap = (force: boolean) => {
    const { map, encounter } = useEncounterStore.getState();
    const inputs = map && encounter ? playerMapInputs(map, encounter) : '';
    const changed = map !== source.map || inputs !== source.inputs;
    if (changed) {
      source = { map, inputs };
      playerMap = map && encounter ? filterMapForPlayers(map, encounter) : null;
      mapRevision++;
    }
    if (changed || force) {
      send({ type: 'map', revision: mapRevision, map: playerMap });
    }
  };

  const publishEncounter = (force: boolean) => {
    const { map, encounter } = useEncounterStore.getState();
    const player = encounter ? filterEncounterForPlayers(encounter, map, useFogViewStore.getState().fog) : null;
    const json = JSON.stringify(player);
    if (json !== sentEncounter || force) {
      sentEncounter = json;
      send({ type: 'encounter', encounter: player });
    }
  };

  const publishFog = (force: boolean) => {
    const fog = useFogViewStore.getState().fog;
    const player: PlayerFog | null = fog
      ? { cellsX: fog.size.cellsX, cellsY: fog.size.cellsY, cells: bytesToBase64(fog.cells) }
      : null;
    const json = JSON.stringify(player);
    if (json !== sentFog || force) {
      sentFog = json;
      send({ type: 'fog', fog: player });
    }
  };

  const publishCamera = (force: boolean) => {
    const { push, camera } = useDmCameraStore.getState();
    // Releasing the push hands the camera back to the player window once.
    if (push || pushing || force) {
      send({ type: 'camera', camera: push ? camera : null });
    }
    pushing = push;
  };

  const publishAll = (force: boolean) => {
    publishMap(force);
    publishEncounter(force);
    publishFog(force);
    publishCamera(force);
  };

  const unsubscribers = [
    useEncounterStore.subscribe(() => {
      publishMap(false);
      publishEncounter(false);
    }),
    useFogViewStore.subscribe((state, previous) => {
      if (state.fog !== previous.fog) {
        publishEncounter(false);
        publishFog(false);
      }
    }),
    useDmCameraStore.subscribe(() => publishCamera(false)),
    ...transports.map((transport) =>
      transport.subscribe((payload) => {
        if (payload.type === 'hello') {
          publishAll(true);
        }
      }),
    ),
  ];
  publishAll(true);

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
