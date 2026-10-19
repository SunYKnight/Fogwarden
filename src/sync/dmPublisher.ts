import { bytesToBase64 } from '@/core/binary';
import { DiceError } from '@/core/rules/dice';
import {
  PARTY_VIEW,
  type BattleMap,
  type CharacterSheet,
  type Creature,
  type PlayerFeatures,
  type PlayerSheetOverlay,
} from '@/core/model';
import type { Spell } from '@/core/spells';
import { viewFog, type FogCells, type FogSources } from '@/core/vision/fog';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { combatantToken, useLibraryStore, type ShownListing } from '@/state/libraryStore';
import { usePingStore } from '@/state/pingStore';
import { combatantTypeIcon, findCreature } from '@/ui/encounter/creatureLookup';
import { useDmCameraStore } from './cameraStore';
import { playerChatLines } from './chat';
import { useHandoutStore } from './handoutStore';
import { ensurePlayerData, onPlayerNotice, usePlayerDataStore } from './playerData';
import { usePlayerViewStore } from './playerViewStore';
import {
  characterDetails,
  filterEncounterForPlayers,
  filterMapForPlayers,
  ownCharacter,
  playerMapInputs,
  playerSheet,
} from './playerFilter';
import { handlePlayerRequest, pingAudience } from './playerRequests';
import type {
  CharacterDetails,
  DmTransport,
  PlayerChatLine,
  PlayerEncounter,
  PlayerFog,
  PlayerHandout,
  SyncPayload,
} from './protocol';
import { detailsWithOverlay } from './sheetEdits';
import { useViewLinksStore } from './views';

// Unique across restarts: players skip a map revision they already have.
let mapRevision = Date.now();
// Same for sheets: a player keeps the sheet content of the revision it has.
let detailsRevision = Date.now();

/** What a view's receivers got last; resends repeat it. */
interface ViewState {
  name: string;
  encounter: PlayerEncounter | null;
  encounterJson: string;
  fog: PlayerFog | null;
  fogJson: string;
  handout: PlayerHandout | null;
  /** The character's full sheet; `encounter` carries only its revision. */
  details: CharacterDetails | null;
  detailsJson: string;
  detailsRevision: number;
  /** Chat lines the view got, oldest first. */
  chat: PlayerChatLine[];
  /** The character's notes; null while the view keeps none or they are not loaded. */
  notes: string | null;
}

type Details = { content: CharacterDetails; json: string };

/** The flags of the campaign's player switches a character's own view gets. */
function featureFlags(features: PlayerFeatures): Partial<PlayerEncounter> {
  return {
    ...(features.uploads && { uploads: true as const }),
    ...(features.chat && { chat: true as const }),
    ...(features.sharedRolls && { sharedRolls: true as const }),
    ...(features.playerNotes && { notes: true as const }),
    ...(features.sheetEdits !== 'off' && { sheetEdits: features.sheetEdits }),
  };
}

/**
 * The chat message that brings a view from `sent` to `lines`: the lines after the last one it got, or all of
 * them (`reset`) when that line is gone, e.g. in another encounter or with the chat switched off. Null when
 * nothing changed.
 */
function chatUpdate(sent: PlayerChatLine[], lines: PlayerChatLine[]): SyncPayload | null {
  const lastId = sent.at(-1)?.id;
  const from = lastId === undefined ? 0 : lines.findIndex((l) => l.id === lastId) + 1;
  const reset = lastId !== undefined && from === 0;
  const added = lines.slice(from);
  return reset || added.length > 0 ? { type: 'chatLines', lines: reset ? lines : added, reset } : null;
}

/** The encounter with its sheet's content, for receivers that lack this revision. */
function withDetails(encounter: PlayerEncounter | null, content: CharacterDetails | null): PlayerEncounter | null {
  const details = encounter?.sheet?.details;
  return encounter?.sheet && details && content
    ? { ...encounter, sheet: { ...encounter.sheet, details: { ...details, content } } }
    : encounter;
}

/**
 * Sends the open encounter to the player views, filtered on the DM side per view: the party sees what any
 * vision source sees, a player character's view only what that character sees, plus that character's sheet (the
 * full sheet with the player's stored changes while the campaign allows it, its text only when it changed), the
 * chat lines it may read and its notes. The map (the same for every view) goes out when it or its
 * player-relevant encounter inputs change, each view's encounter, fog, handout, new chat lines and notes when
 * their content changes, and the DM camera while 'push camera' is on. Pings go to the views that see their
 * spot. Only views with receivers on some transport are computed. A transport's resend request (a player's
 * hello, or its own reconnect) gets the full state of the requested views; players' requests are carried out by
 * `handlePlayerRequest`. The transports stay open when the publisher stops; their owners close them.
 */
export function startDmPublisher(transports: DmTransport[]): () => void {
  let source: { map: BattleMap | null; inputs: string } = { map: null, inputs: '' };
  let playerMap: BattleMap | null = null;
  let pushing = false;
  const activeOn = new Map<DmTransport, ReadonlySet<string>>();
  const sent = new Map<string, ViewState>();
  let fogMemo: { sources: FogSources | null; byView: Map<string, FogCells> } = { sources: null, byView: new Map() };
  // Encounter edits, such as the tracker's explored cells, republish every
  // view; the fog bytes are encoded once per tracker result.
  const fogPayloads = new WeakMap<FogCells, { fog: PlayerFog; json: string }>();
  // Sheets are built and serialised once per library refresh, not on every
  // encounter edit.
  let detailsMemo: {
    sheets: Record<string, CharacterSheet> | null;
    spells: ShownListing<'spell'> | null;
    spellsById: Map<string, Spell>;
    byCreature: WeakMap<Creature, Details>;
    // The player's changes merged once per overlay and library sheet.
    byOverlay: WeakMap<PlayerSheetOverlay, { base: Details; merged: Details }>;
  } = {
    sheets: null,
    spells: null,
    spellsById: new Map(),
    byCreature: new WeakMap(),
    byOverlay: new WeakMap(),
  };

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

  const detailsOf = (creature: Creature, overlay: PlayerSheetOverlay | undefined): Details => {
    const { characterSheets, listings } = useLibraryStore.getState();
    if (detailsMemo.sheets !== characterSheets || detailsMemo.spells !== listings.spell) {
      detailsMemo = {
        sheets: characterSheets,
        spells: listings.spell,
        spellsById: new Map(listings.spell.entries.map((e) => [e.ref.id, e.doc])),
        byCreature: new WeakMap(),
        byOverlay: new WeakMap(),
      };
    }
    let details = detailsMemo.byCreature.get(creature);
    if (!details) {
      const content = characterDetails(creature, characterSheets[creature.id], detailsMemo.spellsById);
      details = { content, json: JSON.stringify(content) };
      detailsMemo.byCreature.set(creature, details);
    }
    const memo = overlay && detailsMemo.byOverlay.get(overlay);
    let merged = memo?.base === details ? memo.merged : undefined;
    if (overlay && !merged) {
      const content = detailsWithOverlay(details.content, overlay);
      merged = { content, json: JSON.stringify(content) };
      detailsMemo.byOverlay.set(overlay, { base: details, merged });
    }
    return merged ?? details;
  };

  const publishView = (view: string): ViewState => {
    const { map, encounter } = useEncounterStore.getState();
    const fog = fogOf(view);
    const library = useLibraryStore.getState();
    const { settings } = useAppStore.getState();
    const links = useViewLinksStore.getState();
    const name = links.linked.find((v) => v.id === view)?.name ?? view;
    const own = encounter ? ownCharacter(encounter, view) : undefined;
    const playerData = usePlayerDataStore.getState();
    const ownData = links.campaignId !== null && playerData.campaignId === links.campaignId;
    if (view !== PARTY_VIEW && links.campaignId !== null) {
      ensurePlayerData(links.campaignId, view);
    }
    const overlay = ownData ? playerData.overlays[view] : undefined;
    const creature = own ? findCreature(own.creature) : null;
    const details = creature && links.features.sheets ? detailsOf(creature, overlay) : null;
    const last = sent.get(view);
    const detailsJson = details?.json ?? 'null';
    const revision = last && last.detailsJson === detailsJson ? last.detailsRevision : ++detailsRevision;
    const ownMoves = encounter?.playersMoveTokens ? (settings?.diagonalRule ?? '5-5-5') : undefined;
    const sheet = own && {
      ...playerSheet(own, creature, overlay?.hitDiceUsed),
      ...(details && { details: { revision } }),
    };
    const playerEncounter = encounter && {
      ...filterEncounterForPlayers(encounter, map, fog, {
        showTurnOrder: usePlayerViewStore.getState().showTurnOrder,
        standees: settings?.tokenStandees ?? true,
        tokenOf: (c) => combatantToken(c, library),
        typeIconOf: (c) => combatantTypeIcon(c.creature),
      }),
      ...(own && { sheet, ownMoves, ...featureFlags(links.features) }),
    };
    const chat = encounter && view !== PARTY_VIEW ? playerChatLines(encounter.chat, view, links.features) : [];
    const notes =
      view !== PARTY_VIEW && links.features.playerNotes && ownData ? (playerData.notes[view] ?? null) : null;
    let fogPayload = fog && fogPayloads.get(fog);
    if (fog && !fogPayload) {
      const encoded: PlayerFog = { cellsX: fog.size.cellsX, cellsY: fog.size.cellsY, cells: bytesToBase64(fog.cells) };
      fogPayload = { fog: encoded, json: JSON.stringify(encoded) };
      fogPayloads.set(fog, fogPayload);
    }
    const playerFog = fogPayload?.fog ?? null;
    const { shown } = useHandoutStore.getState();
    const handout = shown && (shown.audience === null || shown.audience === view) ? shown.handout : null;
    const next: ViewState = {
      name,
      encounter: playerEncounter,
      encounterJson: JSON.stringify(playerEncounter),
      fog: playerFog,
      fogJson: fogPayload?.json ?? 'null',
      handout,
      details: details?.content ?? null,
      detailsJson,
      detailsRevision: revision,
      chat,
      notes,
    };
    sent.set(view, next);
    if (next.name !== last?.name) {
      sendAll([view], { type: 'view', name, combatantId: view === PARTY_VIEW ? null : view });
    }
    if (next.encounterJson !== last?.encounterJson) {
      const content = revision === last?.detailsRevision ? null : next.details;
      sendAll([view], { type: 'encounter', encounter: withDetails(playerEncounter, content) });
    }
    if (next.fogJson !== last?.fogJson) {
      sendAll([view], { type: 'fog', fog: playerFog });
    }
    if (next.handout?.id !== last?.handout?.id) {
      sendAll([view], { type: 'handout', handout });
    }
    const chatMessage = chatUpdate(last?.chat ?? [], chat);
    if (chatMessage) {
      sendAll([view], chatMessage);
    }
    if (notes !== null && notes !== last?.notes) {
      sendAll([view], { type: 'notes', text: notes });
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
  const resend = (transport: DmTransport, view: string | null, hasMap?: number) => {
    const views = view === null ? [...(activeOn.get(transport) ?? [])] : [view];
    publishMap();
    // Multi-MB terrain would reach every device of the view again.
    if (hasMap !== mapRevision) {
      transport.send(views, { type: 'map', revision: mapRevision, map: playerMap });
    }
    for (const each of views) {
      const state = publishView(each);
      const combatantId = each === PARTY_VIEW ? null : each;
      transport.send([each], { type: 'view', name: state.name, combatantId });
      // A new device of the view has no sheet content yet.
      transport.send([each], { type: 'encounter', encounter: withDetails(state.encounter, state.details) });
      transport.send([each], { type: 'fog', fog: state.fog });
      transport.send([each], { type: 'handout', handout: state.handout });
      // A new device starts without lines; the party view never has any.
      if (state.chat.length > 0) {
        transport.send([each], { type: 'chatLines', lines: state.chat, reset: true });
      }
      if (state.notes !== null) {
        transport.send([each], { type: 'notes', text: state.notes });
      }
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
    ...transports.map((transport) => transport.onResend((view, hasMap) => resend(transport, view, hasMap))),
    ...transports.map((transport) =>
      transport.onPlayerRequest((view, request) => {
        try {
          handlePlayerRequest(view, request, (payload) => sendAll([view], payload));
        } catch (error) {
          const { notify, reportError } = useAppStore.getState();
          // Only a modified player page sends dice the DM cannot read.
          if (error instanceof DiceError) {
            notify(`A player's roll was refused: ${error.message}`, 'info');
          } else {
            reportError(error);
          }
        }
      }),
    ),
    usePingStore.subscribe((state, previous) => {
      const known = new Set(previous.pings.map((p) => p.id));
      for (const ping of state.pings.filter((p) => !known.has(p.id))) {
        sendAll(pingAudience(ping.at, ping.from, activeViews(), fogOf), { type: 'ping', at: ping.at, by: ping.by });
      }
    }),
    useHandoutStore.subscribe(publishViews),
    usePlayerDataStore.subscribe((state, previous) => {
      if (state.notes !== previous.notes || state.overlays !== previous.overlays) publishViews();
    }),
    onPlayerNotice((view, text, settles) => sendAll([view], { type: 'notice', text, ...(settles && { settles }) })),
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
      if (state.linked !== previous.linked || state.features !== previous.features) publishViews();
    }),
    useLibraryStore.subscribe((state, previous) => {
      const { creature, spell } = state.listings;
      const changed = creature !== previous.listings.creature || spell !== previous.listings.spell;
      if (changed || state.characterSheets !== previous.characterSheets) publishViews();
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
