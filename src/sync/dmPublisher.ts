import { bytesToBase64 } from '@/core/binary';
import { PARTY_VIEW, type BattleMap } from '@/core/model';
import { viewFog, type FogCells, type FogSources } from '@/core/vision/fog';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { combatantToken, useLibraryStore } from '@/state/libraryStore';
import { useDmCameraStore } from './cameraStore';
import { usePlayerViewStore } from './playerViewStore';
import { filterEncounterForPlayers, filterMapForPlayers, playerMapInputs } from './playerFilter';
import type { DmTransport, PlayerEncounter, PlayerFog, SyncPayload } from './protocol';
import { useViewLinksStore } from './views';

// Unique across restarts: players skip a map revision they already have.
let mapRevision = Date.now();

/** What a view's receivers got last; resends repeat it. */
interface ViewState {
  name: string;
  encounter: PlayerEncounter | null;
  encounterJson: string;
  fog: PlayerFog | null;
  fogJson: string;
}

/**
 * Sends the open encounter to the player views, filtered on the DM side per view: the party sees what any
 * vision source sees, a player character's view only what that character sees. The map (the same for every
 * view) goes out when it or its player-relevant encounter inputs change, each view's encounter and fog when
 * their content changes, and the DM camera while 'push camera' is on. Only views with receivers on some
 * transport are computed. A transport's resend request (a player's hello, or its own reconnect) gets the
 * full state of the requested views. The transports stay open when the publisher stops; their owners close
 * them.
 */
export function startDmPublisher(transports: DmTransport[]): () => void {
  let source: { map: BattleMap | null; inputs: string } = { map: null, inputs: '' };
  let playerMap: BattleMap | null = null;
  let pushing = false;
  const activeOn = new Map<DmTransport, ReadonlySet<string>>();
  const sent = new Map<string, ViewState>();
  let fogMemo: { sources: FogSources | null; byView: Map<string, FogCells> } = { sources: null, byView: new Map() };

  const activeViews = () => [...new Set([...activeOn.values()].flatMap((views) => [...views]))];

  const sendAll = (views: readonly string[], payload: SyncPayload) => {
    for (const transport of transports) {
      transport.send(views, payload);
    }
  };

  // Single characters' fog is composed only for views someone watches, once
  // per tracker result.
  const fogOf = (view: string): FogCells | null => {
    const { fog, sources } = useFogViewStore.getState();
    if (fogMemo.sources !== sources) {
      fogMemo = { sources, byView: new Map() };
    }
    const cached = fogMemo.byView.get(view);
    const composed = view === PARTY_VIEW || !sources ? null : (cached ?? viewFog(sources, [view]));
    if (composed && !cached) {
      fogMemo.byView.set(view, composed);
    }
    return view === PARTY_VIEW ? fog : composed;
  };

  const publishMap = () => {
    const { map, encounter } = useEncounterStore.getState();
    const inputs = map && encounter ? playerMapInputs(map, encounter) : '';
    if (map !== source.map || inputs !== source.inputs) {
      source = { map, inputs };
      playerMap = map && encounter ? filterMapForPlayers(map, encounter) : null;
      mapRevision++;
      sendAll(activeViews(), { type: 'map', revision: mapRevision, map: playerMap });
    }
  };

  const publishView = (view: string): ViewState => {
    const { map, encounter } = useEncounterStore.getState();
    const fog = fogOf(view);
    const library = useLibraryStore.getState();
    const name = useViewLinksStore.getState().views.find((v) => v.id === view)?.name ?? view;
    const playerEncounter =
      encounter &&
      filterEncounterForPlayers(encounter, map, fog, {
        showTurnOrder: usePlayerViewStore.getState().showTurnOrder,
        standees: useAppStore.getState().settings?.tokenStandees ?? true,
        tokenOf: (c) => combatantToken(c, library),
      });
    const playerFog: PlayerFog | null = fog
      ? { cellsX: fog.size.cellsX, cellsY: fog.size.cellsY, cells: bytesToBase64(fog.cells) }
      : null;
    const last = sent.get(view);
    const next: ViewState = {
      name,
      encounter: playerEncounter,
      encounterJson: JSON.stringify(playerEncounter),
      fog: playerFog,
      fogJson: JSON.stringify(playerFog),
    };
    sent.set(view, next);
    if (next.name !== last?.name) {
      sendAll([view], { type: 'view', name });
    }
    if (next.encounterJson !== last?.encounterJson) {
      sendAll([view], { type: 'encounter', encounter: playerEncounter });
    }
    if (next.fogJson !== last?.fogJson) {
      sendAll([view], { type: 'fog', fog: playerFog });
    }
    return next;
  };

  const publishViews = () => {
    for (const view of activeViews()) {
      publishView(view);
    }
  };

  const publishCamera = () => {
    const { push, camera } = useDmCameraStore.getState();
    // Releasing the push hands the camera back to the player views once.
    if (push || pushing) {
      sendAll(activeViews(), { type: 'camera', camera: push ? camera : null });
    }
    pushing = push;
  };

  // Changes go to every transport first, so the resend can repeat the
  // current state to this transport alone.
  const resend = (transport: DmTransport, view: string | null) => {
    const views = view === null ? [...(activeOn.get(transport) ?? [])] : [view];
    publishMap();
    transport.send(views, { type: 'map', revision: mapRevision, map: playerMap });
    for (const each of views) {
      const state = publishView(each);
      transport.send([each], { type: 'view', name: state.name });
      transport.send([each], { type: 'encounter', encounter: state.encounter });
      transport.send([each], { type: 'fog', fog: state.fog });
    }
    const { push, camera } = useDmCameraStore.getState();
    transport.send(views, { type: 'camera', camera: push ? camera : null });
  };

  const watchViews = (transport: DmTransport) =>
    transport.watchViews((views) => {
      activeOn.set(transport, views);
      const active = new Set(activeViews());
      for (const view of sent.keys()) {
        if (!active.has(view)) {
          sent.delete(view);
        }
      }
    });

  const unsubscribers = [
    ...transports.map(watchViews),
    ...transports.map((transport) => transport.onResend((view) => resend(transport, view))),
    useEncounterStore.subscribe(() => {
      publishMap();
      publishViews();
    }),
    useFogViewStore.subscribe((state, previous) => {
      if (state.fog !== previous.fog || state.sources !== previous.sources) {
        publishViews();
      }
    }),
    useDmCameraStore.subscribe(publishCamera),
    usePlayerViewStore.subscribe(publishViews),
    useViewLinksStore.subscribe((state, previous) => {
      if (state.views !== previous.views) publishViews();
    }),
    useLibraryStore.subscribe((state, previous) => {
      if (state.listings.creature !== previous.listings.creature) publishViews();
    }),
    useAppStore.subscribe((state, previous) => {
      if (state.settings !== previous.settings) publishViews();
    }),
  ];
  // Nothing was sent yet, so this sends everything to every watched view.
  publishMap();
  publishViews();
  publishCamera();

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
