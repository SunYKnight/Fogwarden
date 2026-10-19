import { applyPatches, type Draft, type Patch } from 'immer';
import { z } from 'zod';
import { create } from 'zustand';
import type { MusicState } from '@/core/atmosphere/playlist';
import { base64ToBytes, bytesToBase64 } from '@/core/binary';
import { calendarSchema } from '@/core/campaign/calendar';
import {
  assetRefSchema,
  docRefSchema,
  encounterLocatorSchema,
  mapPointSchema,
  type AssetRef,
  type BattleMap,
  type DocRef,
  type Encounter,
} from '@/core/model';
import type { FogCells, FogSize } from '@/core/vision/fog';
import { RemoteDmStorage } from '@/data/remoteDmStorage';
import type { CameraState } from '@/render/CameraRig';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useInterludeStore } from '@/sound/interlude';
import { onSoundEffect, playEffect, reloadSounds, useSoundStore } from '@/sound/soundStore';
import { useAppStore } from '@/state/appStore';
import { useCalendarStore } from '@/state/calendarStore';
import { isTrackedPatch, onEncounterChange, setEncounterRemote, useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { usePingStore } from '@/state/pingStore';
import { useDmCameraStore } from './cameraStore';
import { useHandoutStore, type ShownHandout } from './handoutStore';
import { usePlayerViewStore } from './playerViewStore';
import { useViewLinksStore, type ViewLinksState } from './views';
import { ReconnectingSocket } from './wsTransport';

/**
 * Text channel between the desktop app and its remote DMs (the DM's second device on the LAN): the LAN server's
 * `@dm` frames on the desktop, the remote DM's own socket on the other side.
 */
export interface MirrorChannel {
  send(text: string): void;
  onText(handler: (text: string) => void): () => void;
  /** Calls `handler` with whether the channel is open: now and on every connect and disconnect. */
  watchConnection(handler: (open: boolean) => void): () => void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const patchSchema = z.object({
  op: z.enum(['add', 'remove', 'replace']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});

// Handouts, cameras and music are the DM's own; only their shape is checked.
const sessionSchema = z.object({
  handout: z.custom<ShownHandout>(isObject).nullable(),
  showTurnOrder: z.boolean(),
  cameraPush: z.boolean(),
  /** The camera the players follow; null while not pushing. */
  camera: z.custom<CameraState>(isObject).nullable(),
  music: z.custom<MusicState>(isObject),
  interlude: z.object({ asset: assetRefSchema, startedAtMs: z.number() }).nullable(),
  /** Calendar of the running encounter's campaign; null without an encounter. */
  calendar: z.object({ campaignId: z.string(), calendar: calendarSchema.nullable() }).nullable(),
  lastEncounter: encounterLocatorSchema.nullable(),
});

/** What both DMs control besides the encounter: shown handout, camera push, music, interlude, time, encounter. */
export type MirrorSession = z.infer<typeof sessionSchema>;

const commandSchema = z.discriminatedUnion('type', [
  /** Sent on every connect; the desktop answers with everything, the map only if `mapKey` is not its own. */
  z.object({ type: z.literal('hello'), mapKey: z.string().nullable() }),
  /** Immer patches of one change, made on top of the desktop's `base`. */
  z.object({
    type: z.literal('update'),
    id: z.string(),
    encounterId: z.string(),
    base: z.number(),
    label: z.string(),
    patches: z.array(patchSchema),
  }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('redo') }),
  z.object({ type: z.literal('session'), session: sessionSchema }),
  z.object({ type: z.literal('ping'), at: mapPointSchema }),
  z.object({ type: z.literal('effect'), asset: assetRefSchema, volume: z.number() }),
  z.object({ type: z.literal('changeMap'), ref: docRefSchema.nullable() }),
  /** The remote DM wrote files; the desktop reads its library again. */
  z.object({ type: z.literal('refresh') }),
]);

/** A remote DM's message to the desktop. */
export type MirrorCommand = z.infer<typeof commandSchema>;

interface EncodedFog {
  size: FogSize;
  cells: string;
}

interface UndoState {
  /** Counts the desktop's tracked changes (undo steps), undo, redo and encounter switches. */
  base: number;
  canUndo: boolean;
  canRedo: boolean;
}

/** The desktop's player views; their link tokens stay on the desktop. */
type MirrorViews = Omit<ViewLinksState, 'tokens'>;

/** The desktop's message to its remote DMs. */
export type MirrorFrame =
  /** The full map, once per map the encounter plays on (`mapKey`). */
  | { type: 'map'; mapKey: string; map: BattleMap | null }
  /** The whole encounter; after a hello, an encounter switch or a refused update (`rejected`: its id). */
  | ({
      type: 'snapshot';
      encounter: Encounter | null;
      revision: number;
      mapKey: string;
      rejected: string | null;
    } & UndoState)
  /** One change from revision `from` to `to`; `origin` is the id of the remote DM's update it came from. */
  | ({ type: 'patches'; patches: Patch[]; from: number; to: number; origin: string | null } & UndoState)
  | { type: 'fog'; fog: EncodedFog | null; computeMs: number | null }
  | { type: 'session'; session: MirrorSession }
  /** Who the DM can show things to or whisper to; the desktop alone derives them (`startViewLinks`). */
  | ({ type: 'views' } & MirrorViews)
  | { type: 'ping'; at: z.infer<typeof mapPointSchema>; by: string };

const frameSchema = z.custom<MirrorFrame>((value) => isObject(value) && typeof value.type === 'string');

function currentSession(): MirrorSession {
  const camera = useDmCameraStore.getState();
  const { campaignId, calendar } = useCalendarStore.getState();
  return {
    handout: useHandoutStore.getState().shown,
    showTurnOrder: usePlayerViewStore.getState().showTurnOrder,
    cameraPush: camera.push,
    camera: camera.push ? camera.camera : null,
    music: useSoundStore.getState().music,
    interlude: useInterludeStore.getState().interlude,
    calendar: campaignId === null ? null : { campaignId, calendar },
    lastEncounter: useAppStore.getState().settings?.lastEncounter ?? null,
  };
}

// Only what differs is set, so stores and their subscribers see no change
// where there is none.
function setIfChanged<T>(current: T, next: T, set: (value: T) => void): void {
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    set(next);
  }
}

/** Puts `session` into this side's stores; the encounter switch is the caller's (`openEncounter`). */
function applySession(session: MirrorSession, openEncounter: (locator: MirrorSession['lastEncounter']) => void) {
  const camera = useDmCameraStore.getState();
  setIfChanged(useHandoutStore.getState().shown, session.handout, (shown) => useHandoutStore.setState({ shown }));
  setIfChanged(usePlayerViewStore.getState().showTurnOrder, session.showTurnOrder, (showTurnOrder) =>
    usePlayerViewStore.setState({ showTurnOrder }),
  );
  setIfChanged(
    { push: camera.push, camera: camera.push ? camera.camera : null },
    { push: session.cameraPush, camera: session.camera },
    ({ push, camera: pushed }) => useDmCameraStore.setState(pushed ? { push, camera: pushed } : { push }),
  );
  setIfChanged(useSoundStore.getState().music, session.music, (music) => useSoundStore.setState({ music }));
  setIfChanged(useInterludeStore.getState().interlude, session.interlude, (interlude) =>
    useInterludeStore.setState({ interlude }),
  );
  const calendar = useCalendarStore.getState();
  setIfChanged(useAppStore.getState().settings?.lastEncounter ?? null, session.lastEncounter, openEncounter);
  // The desktop loads the calendar of its encounter's campaign itself; a
  // calendar of another campaign is a late message.
  if (session.calendar && session.calendar.campaignId === calendar.campaignId) {
    setIfChanged(calendar.calendar, session.calendar.calendar, (next) => useCalendarStore.setState({ calendar: next }));
  }
}

/** Calls `publish` whenever this side's session may have changed. */
function watchSession(publish: () => void): (() => void)[] {
  return [
    useHandoutStore.subscribe(publish),
    usePlayerViewStore.subscribe(publish),
    useDmCameraStore.subscribe(publish),
    useSoundStore.subscribe((state, previous) => state.music !== previous.music && publish()),
    useInterludeStore.subscribe(publish),
    useCalendarStore.subscribe(publish),
    useAppStore.subscribe((state, previous) => state.settings !== previous.settings && publish()),
  ];
}

function encodeFog(fog: FogCells): EncodedFog {
  return { size: fog.size, cells: bytesToBase64(fog.cells) };
}

/**
 * Applies a remote DM's patches inside a desktop `update`. A log or chat line the remote DM appended goes to the
 * end: the desktop's list may have grown meanwhile, and the remote DM's index would put it between older lines.
 */
export function applyRemotePatches(draft: Draft<Encounter>, patches: readonly Patch[]): void {
  for (const patch of patches) {
    const [field, index] = patch.path;
    const list: unknown = draft[field as keyof Encounter];
    const appended = patch.op === 'add' && patch.path.length === 2 && typeof index === 'number';
    if (appended && !isTrackedPatch(patch) && Array.isArray(list)) {
      list.push(patch.value);
    } else {
      applyPatches(draft, [patch]);
    }
  }
}

export interface MirrorPublisherOptions {
  /** Moves the running encounter to another map, as Play's map dialog does on the desktop. */
  changeMap(ref: DocRef | null): Promise<void>;
}

/**
 * Desktop side of the remote DM: sends the encounter (snapshots, then the patches of every change), its map, the
 * fog the visibility worker computed, the session and the player views to the remote DMs, and applies their
 * commands. An update is applied only on top of the state it was made on: when the desktop made a tracked change
 * meanwhile (`base` moved) or the encounter changed, the remote DM gets a snapshot instead. Log, chat and fog
 * patches never conflict, so they always apply. Returns the stop function.
 */
export function startDmMirrorPublisher(channel: MirrorChannel, options: MirrorPublisherOptions): () => void {
  const reportError = (error: unknown) => useAppStore.getState().reportError(error);
  const mapSession = Math.random().toString(36).slice(2);
  let mapSerial = 0;
  let mapOf: BattleMap | null | undefined;
  let base = 0;
  let origin: string | null = null;
  let relayedPing = false;
  let sessionKey = JSON.stringify(currentSession());
  // Without a remote DM nothing is encoded: snapshots and maps are large.
  let open = false;

  const send = (frame: MirrorFrame) => {
    if (open) channel.send(JSON.stringify(frame));
  };
  const undoState = (): UndoState => {
    const { canUndo, canRedo } = useEncounterStore.getState();
    return { base, canUndo, canRedo };
  };
  // A new key for every map object the store holds, so a reloaded or
  // changed map is sent again.
  const currentMapKey = () => {
    const { map } = useEncounterStore.getState();
    if (map !== mapOf) {
      mapOf = map;
      mapSerial += 1;
    }
    return `${mapSession}:${mapSerial}`;
  };
  const sendMap = () => send({ type: 'map', mapKey: currentMapKey(), map: useEncounterStore.getState().map });
  const sendSnapshot = (rejected: string | null) => {
    const { encounter, revision } = useEncounterStore.getState();
    send({ type: 'snapshot', encounter, revision, mapKey: currentMapKey(), rejected, ...undoState() });
  };
  const sendFog = () => {
    const { fog, computeMs } = useFogViewStore.getState();
    if (open) send({ type: 'fog', fog: fog && encodeFog(fog), computeMs });
  };
  const sendSession = () => {
    const session = currentSession();
    sessionKey = JSON.stringify(session);
    send({ type: 'session', session });
  };
  const publishSession = () => {
    if (JSON.stringify(currentSession()) !== sessionKey) sendSession();
  };
  const sendViews = () => {
    const { views, linked, campaignId, features } = useViewLinksStore.getState();
    send({ type: 'views', views, linked, campaignId, features });
  };
  const sendState = () => {
    sendSnapshot(null);
    sendFog();
    sendSession();
    sendViews();
  };
  // The map only when the remote DM does not hold it: maps are large.
  const sendAll = (mapKey: string | null) => {
    if (mapKey !== currentMapKey()) sendMap();
    sendState();
  };

  const applyUpdate = (command: Extract<MirrorCommand, { type: 'update' }>) => {
    const { encounter, revision, update } = useEncounterStore.getState();
    const tracked = command.patches.some(isTrackedPatch);
    let applied = encounter?.id === command.encounterId && (!tracked || command.base === base);
    if (applied) {
      origin = command.id;
      try {
        update((draft) => applyRemotePatches(draft, command.patches), command.label);
      } catch {
        // Patches that no longer fit the encounter are a conflict like a
        // moved base: the snapshot shows the remote DM what holds now.
        applied = false;
      } finally {
        origin = null;
      }
    }
    if (!applied) {
      sendSnapshot(command.id);
    } else if (useEncounterStore.getState().revision === revision) {
      // An update that changed nothing still answers its pending change.
      send({ type: 'patches', patches: [], from: revision, to: revision, origin: command.id, ...undoState() });
    }
  };

  const playRemoteEffect = (asset: AssetRef, volume: number) => {
    const effect = useSoundStore
      .getState()
      .library.effects.find((e) => e.asset.area === asset.area && e.asset.path === asset.path);
    if (!effect) {
      throw new Error('The remote DM played a sound effect this computer does not have; reload its library');
    }
    playEffect({ ...effect, volume });
  };

  const handle = (command: MirrorCommand) => {
    switch (command.type) {
      case 'hello':
        sendAll(command.mapKey);
        break;
      case 'update':
        applyUpdate(command);
        break;
      case 'undo':
        useEncounterStore.getState().undo();
        break;
      case 'redo':
        useEncounterStore.getState().redo();
        break;
      case 'session':
        sessionKey = JSON.stringify(command.session);
        applySession(command.session, (lastEncounter) => {
          const { settings, setSettings } = useAppStore.getState();
          if (settings) setSettings({ ...settings, lastEncounter }).catch(reportError);
        });
        break;
      case 'ping':
        relayedPing = true;
        usePingStore.getState().add({ at: command.at, by: 'DM', from: null });
        relayedPing = false;
        break;
      case 'effect':
        playRemoteEffect(command.asset, command.volume);
        break;
      case 'changeMap':
        options.changeMap(command.ref).catch(reportError);
        break;
      case 'refresh':
        Promise.all([useLibraryStore.getState().refreshAll(), reloadSounds()]).catch(reportError);
        break;
    }
  };

  const unsubscribers = [
    channel.onText((text) => {
      try {
        handle(commandSchema.parse(JSON.parse(text)));
      } catch (error) {
        reportError(error);
      }
    }),
    // The remote DMs missed everything while none was connected or this
    // window was away. A snapshot of a map they lack makes them ask for it.
    channel.watchConnection((connected) => {
      open = connected;
      if (open) sendState();
    }),
    onEncounterChange(({ patches, from, to }) => {
      if (patches === null) {
        base += 1;
        const known = mapOf;
        currentMapKey();
        if (mapOf !== known) sendMap();
        sendSnapshot(null);
      } else {
        base += patches.some(isTrackedPatch) ? 1 : 0;
        send({ type: 'patches', patches, from, to, origin, ...undoState() });
      }
    }),
    useFogViewStore.subscribe((state, previous) => {
      if (state.fog !== previous.fog || state.computeMs !== previous.computeMs) sendFog();
    }),
    usePingStore.subscribe((state, previous) => {
      const known = new Set(previous.pings.map((p) => p.id));
      for (const ping of state.pings.filter((p) => !known.has(p.id) && !relayedPing)) {
        send({ type: 'ping', at: ping.at, by: ping.by });
      }
    }),
    useViewLinksStore.subscribe((state, previous) => {
      const changed = state.views !== previous.views || state.linked !== previous.linked;
      if (changed || state.campaignId !== previous.campaignId || state.features !== previous.features) sendViews();
    }),
    ...watchSession(publishSession),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

interface RemoteDmState {
  /** Host (`name:port`) of the desktop app this window controls; null in the desktop app itself. */
  host: string | null;
  /** The DM link's token. */
  token: string;
  connected: boolean;
  /** The encounter shown is the desktop's, received since the last connect. */
  synced: boolean;
  /** The DM replaced the link; this page stays disconnected. */
  revoked: boolean;
  /** Counts the connections this window opened; a new one replaces the socket. */
  generation: number;
}

/** Whether this window is a remote DM and how its connection stands; the banner shows it. */
export const useRemoteDmStore = create<RemoteDmState>(() => ({
  host: null,
  token: '',
  connected: false,
  synced: false,
  revoked: false,
  generation: 0,
}));

export interface MirrorClientOptions {
  /** Calls the handler after every file this window writes; the desktop then reads its library again. */
  watchWrites?(handler: () => void): () => void;
}

// Writes come in bursts (an editor save, a pack copy); one refresh follows.
const REFRESH_DELAY_MS = 500;

interface PendingUpdate {
  id: string;
  patches: Patch[];
  tracked: boolean;
}

/**
 * Remote DM side: shows the desktop's encounter, map, fog, session and player views, sends every local change as
 * patches with the desktop state it was made on, and undo and redo as commands for the desktop's history. Local
 * changes show at once on top of the last confirmed state until the desktop applies or refuses them. Returns the
 * stop function.
 */
export function startDmMirrorClient(channel: MirrorChannel, options: MirrorClientOptions = {}): () => void {
  const clientId = Math.random().toString(36).slice(2);
  clientChannel = channel;
  let nextId = 1;
  let confirmed: Encounter | null = null;
  let confirmedRevision = 0;
  let undo: UndoState = { base: 0, canUndo: false, canRedo: false };
  let pending: PendingUpdate[] = [];
  let synced = false;
  let map: { key: string; map: BattleMap | null } | null = null;
  // Encounter and map the store has open; another one needs `open`.
  let shown: { encounterId: string; mapKey: string } | null = null;
  let waiting: Extract<MirrorFrame, { type: 'snapshot' }> | null = null;
  let applying = false;
  let sessionKey = '';
  let cancelRefresh: () => void = () => undefined;

  const send = (command: MirrorCommand) => channel.send(JSON.stringify(command));
  const setSynced = (value: boolean) => {
    synced = value;
    useRemoteDmStore.setState({ synced: value });
  };
  const hello = () => {
    setSynced(false);
    send({ type: 'hello', mapKey: map?.key ?? null });
  };

  // Pending changes that no longer apply on top of the confirmed state are
  // left out; the desktop's answer to them decides.
  const show = () => {
    const kept: PendingUpdate[] = [];
    let display = confirmed;
    for (const update of pending) {
      try {
        display = display && applyPatches(display, update.patches);
        kept.push(update);
      } catch {
        // See above: the desktop refuses or applies it, and says so.
      }
    }
    pending = kept;
    const store = useEncounterStore.getState();
    const { canUndo, canRedo } = undo;
    if (display && confirmed && map && (shown?.encounterId !== confirmed.id || shown.mapKey !== map.key)) {
      shown = { encounterId: confirmed.id, mapKey: map.key };
      store.open(display, map.map);
    } else if (!display && shown) {
      shown = null;
      store.close();
    }
    const revision = useEncounterStore.getState().revision + 1;
    useEncounterStore.setState({ encounter: display, revision, savedRevision: revision, canUndo, canRedo });
  };

  const applySnapshot = (frame: Extract<MirrorFrame, { type: 'snapshot' }>) => {
    if (frame.encounter && frame.mapKey !== map?.key) {
      // The map comes first; a missed one is asked for once.
      if (waiting?.mapKey !== frame.mapKey) hello();
      waiting = frame;
    } else {
      waiting = null;
      confirmed = frame.encounter;
      confirmedRevision = frame.revision;
      undo = { base: frame.base, canUndo: frame.canUndo, canRedo: frame.canRedo };
      pending = [];
      setSynced(true);
      if (frame.rejected?.startsWith(`${clientId}:`)) {
        useAppStore
          .getState()
          .notify('The encounter changed on the desktop first; your last change was undone', 'info');
      }
      show();
    }
  };

  const applyChange = (frame: Extract<MirrorFrame, { type: 'patches' }>) => {
    if (synced && confirmed && frame.from === confirmedRevision) {
      confirmed = applyPatches(confirmed, frame.patches);
      confirmedRevision = frame.to;
      undo = { base: frame.base, canUndo: frame.canUndo, canRedo: frame.canRedo };
      pending = pending.filter((update) => update.id !== frame.origin);
      show();
    } else if (synced) {
      // A frame went missing (the socket fell behind): start over.
      hello();
    }
  };

  const receive = (frame: MirrorFrame) => {
    switch (frame.type) {
      case 'map':
        map = { key: frame.mapKey, map: frame.map };
        if (waiting?.mapKey === frame.mapKey) applySnapshot(waiting);
        break;
      case 'snapshot':
        applySnapshot(frame);
        break;
      case 'patches':
        applyChange(frame);
        break;
      case 'fog': {
        const fog = frame.fog && { size: frame.fog.size, cells: base64ToBytes(frame.fog.cells) };
        useFogViewStore.getState().setFog(fog, null, frame.computeMs);
        break;
      }
      case 'session':
        applying = true;
        sessionKey = JSON.stringify(frame.session);
        try {
          applySession(frame.session, (lastEncounter) => {
            const { settings } = useAppStore.getState();
            if (settings) useAppStore.setState({ settings: { ...settings, lastEncounter } });
          });
          if (!frame.session.calendar || frame.session.calendar.campaignId !== useCalendarStore.getState().campaignId) {
            useCalendarStore.setState({
              campaignId: frame.session.calendar?.campaignId ?? null,
              calendar: frame.session.calendar?.calendar ?? null,
            });
          }
        } finally {
          applying = false;
        }
        break;
      case 'views':
        useViewLinksStore.setState({
          views: frame.views,
          linked: frame.linked,
          campaignId: frame.campaignId,
          features: frame.features,
        });
        break;
      case 'ping':
        applying = true;
        usePingStore.getState().add({ at: frame.at, by: frame.by, from: null });
        applying = false;
        break;
    }
  };

  const publishSession = () => {
    const key = JSON.stringify(currentSession());
    if (!applying && key !== sessionKey) {
      sessionKey = key;
      send({ type: 'session', session: currentSession() });
    }
  };

  setEncounterRemote({
    update: (patches, label) => {
      const id = `${clientId}:${nextId++}`;
      // The desktop's base moves with every tracked change still on its way.
      const base = undo.base + pending.filter((update) => update.tracked).length;
      const tracked = patches.some(isTrackedPatch);
      pending.push({ id, patches, tracked });
      send({ type: 'update', id, encounterId: confirmed?.id ?? '', base, label, patches });
    },
    undo: () => send({ type: 'undo' }),
    redo: () => send({ type: 'redo' }),
  });

  const unsubscribers = [
    channel.onText((text) => receive(frameSchema.parse(JSON.parse(text)))),
    channel.watchConnection((open) => {
      useRemoteDmStore.setState({ connected: open });
      if (open) hello();
      else setSynced(false);
    }),
    usePingStore.subscribe((state, previous) => {
      const known = new Set(previous.pings.map((p) => p.id));
      const mine = state.pings.filter((p) => !known.has(p.id) && p.by === 'DM' && p.from === null);
      for (const ping of applying ? [] : mine) {
        send({ type: 'ping', at: ping.at });
      }
    }),
    onSoundEffect((asset, volume) => send({ type: 'effect', asset, volume })),
    ...watchSession(publishSession),
    options.watchWrites?.(() => {
      cancelRefresh();
      const timer = setTimeout(() => send({ type: 'refresh' }), REFRESH_DELAY_MS);
      cancelRefresh = () => clearTimeout(timer);
    }) ?? (() => undefined),
  ];

  return () => {
    setEncounterRemote(null);
    clientChannel = null;
    cancelRefresh();
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

let clientChannel: MirrorChannel | null = null;

/** Asks the desktop to move its encounter to another map, as Play's map dialog does there. */
export function remoteChangeMap(ref: DocRef | null): void {
  if (!clientChannel) {
    throw new Error('This window controls no desktop app');
  }
  clientChannel.send(JSON.stringify({ type: 'changeMap', ref } satisfies MirrorCommand));
}

/** The remote DM's socket to the desktop's LAN server; reconnects until closed or until the link is replaced. */
export class RemoteDmSocket implements MirrorChannel {
  private readonly handlers = new Set<(text: string) => void>();
  private readonly socket: ReconnectingSocket;

  constructor(url: string, createSocket: (url: string) => WebSocket = (u) => new WebSocket(u)) {
    this.socket = new ReconnectingSocket(url, createSocket, {
      open: () => undefined,
      text: (data) => {
        for (const handler of this.handlers) {
          handler(data);
        }
      },
    });
  }

  /** The DM replaced the link; the socket stays closed. */
  get revoked(): boolean {
    return this.socket.revoked;
  }

  send(text: string): void {
    this.socket.send(text);
  }

  onText(handler: (text: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  watchConnection(handler: (open: boolean) => void): () => void {
    return this.socket.watchConnection(handler);
  }

  close(): void {
    this.socket.close();
  }
}

/**
 * Connects this window as the remote DM of the desktop app in `useRemoteDmStore` (set by `dm.tsx` from the DM
 * link) and starts the mirror; returns the stop function.
 */
export function startRemoteDm(): () => void {
  const { host, token } = useRemoteDmStore.getState();
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new RemoteDmSocket(`${scheme}://${host}/ws?token=${encodeURIComponent(token)}`);
  const storage = useAppStore.getState().repository.storage;
  const watchWrites = storage instanceof RemoteDmStorage ? storage.watchWrites.bind(storage) : undefined;
  const stopClient = startDmMirrorClient(socket, { watchWrites });
  const stopWatching = socket.watchConnection((open) =>
    useRemoteDmStore.setState({ revoked: !open && socket.revoked }),
  );
  return () => {
    stopWatching();
    stopClient();
    socket.close();
  };
}
