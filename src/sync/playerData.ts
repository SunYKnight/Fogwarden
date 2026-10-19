import { create } from 'zustand';
import { sheetEditTarget, type PendingSheetEdit, type PlayerSheetOverlay, type SheetEdit } from '@/core/model';
import { useAppStore } from '@/state/appStore';

/** A player's sheet edit waiting for the DM in 'approve' mode, with the view it came from. */
export interface PendingViewEdit extends PendingSheetEdit {
  view: string;
}

interface PlayerDataState {
  /** The campaign whose files the maps below hold. */
  campaignId: string | null;
  /** Each character view's notes, once loaded. */
  notes: Record<string, string>;
  /** Each character view's sheet overlay, once loaded. */
  overlays: Record<string, PlayerSheetOverlay>;
  /** Oldest first. */
  pending: PendingViewEdit[];
}

/**
 * What players keep in the open campaign beyond the encounter: notes, sheet changes and session state, and the
 * sheet edits waiting for the DM, loaded per view on first use and written back to `campaigns/<id>/players/<view>/`.
 */
export const usePlayerDataStore = create<PlayerDataState>(() => ({
  campaignId: null,
  notes: {},
  overlays: {},
  pending: [],
}));

// Views asked for by campaign with their loads; a campaign switch starts over.
let requested: { campaignId: string | null; views: Map<string, Promise<void>> } = {
  campaignId: null,
  views: new Map(),
};
// Each view's last file work; the next one waits, so files land in order.
const writes = new Map<string, Promise<void>>();

/** Switches the store to `campaignId`, dropping another campaign's data. */
function switchCampaign(campaignId: string): void {
  if (usePlayerDataStore.getState().campaignId !== campaignId) {
    usePlayerDataStore.setState({ campaignId, notes: {}, overlays: {}, pending: [] });
  }
}

function queueWrite<T>(campaignId: string, view: string, work: () => Promise<T>): Promise<T> {
  const key = `${campaignId}/${view}`;
  const next = (writes.get(key) ?? Promise.resolve()).then(work);
  // A failed write is reported once; the following ones still run.
  writes.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Loads the notes, sheet overlay and waiting edits of `view` in `campaignId` unless asked before; resolves once
 * they are in the store or the failure is reported. The store changes only once the files are read, so
 * publishers may call it while they publish.
 */
export function ensurePlayerData(campaignId: string, view: string): Promise<void> {
  if (requested.campaignId !== campaignId) {
    requested = { campaignId, views: new Map() };
  }
  const views = requested.views;
  let loaded = views.get(view);
  if (!loaded) {
    const { repository, reportError } = useAppStore.getState();
    // In the view's queue: a write asked for meanwhile runs after the read,
    // so it keeps what the files held.
    const load = queueWrite(campaignId, view, async () => {
      const [notes, overlay, pending] = await Promise.all([
        repository.loadPlayerNotes(campaignId, view),
        repository.loadPlayerSheet(campaignId, view),
        repository.loadPlayerPending(campaignId, view),
      ]);
      // A late load of a campaign closed meanwhile is dropped.
      if (requested.campaignId === campaignId) {
        switchCampaign(campaignId);
        const state = usePlayerDataStore.getState();
        // What the player sent while the files loaded is newer.
        const live = state.pending.filter((p) => p.view === view);
        const stored = pending
          .filter((p) => !live.some((l) => l.id === p.id || sheetEditTarget(l.edit) === sheetEditTarget(p.edit)))
          .map((p) => ({ ...p, view }));
        usePlayerDataStore.setState({
          notes: view in state.notes ? state.notes : { ...state.notes, [view]: notes },
          overlays: view in state.overlays ? state.overlays : { ...state.overlays, [view]: overlay },
          pending: [...stored, ...state.pending],
        });
      }
    });
    loaded = load.catch((error: unknown) => {
      views.delete(view);
      reportError(error);
    });
    views.set(view, loaded);
  }
  return loaded;
}

/** Keeps the player's notes and writes them to the campaign. */
export function storePlayerNotes(campaignId: string, view: string, text: string): Promise<void> {
  switchCampaign(campaignId);
  usePlayerDataStore.setState((s) => ({ notes: { ...s.notes, [view]: text } }));
  const { repository } = useAppStore.getState();
  return queueWrite(campaignId, view, () => repository.storePlayerNotes(campaignId, view, text));
}

/** Keeps the player's sheet changes and session state and writes them to the campaign. */
export function storePlayerSheet(campaignId: string, view: string, overlay: PlayerSheetOverlay): Promise<void> {
  switchCampaign(campaignId);
  usePlayerDataStore.setState((s) => ({ overlays: { ...s.overlays, [view]: overlay } }));
  const { repository } = useAppStore.getState();
  return queueWrite(campaignId, view, () => repository.storePlayerSheet(campaignId, view, overlay));
}

/** The view's sheet overlay once earlier writes landed: the store's while it holds it, else the file's. */
export function readPlayerSheet(campaignId: string, view: string): Promise<PlayerSheetOverlay> {
  const { repository } = useAppStore.getState();
  return queueWrite(campaignId, view, async () => {
    const state = usePlayerDataStore.getState();
    const held = state.campaignId === campaignId ? state.overlays[view] : undefined;
    return held ?? repository.loadPlayerSheet(campaignId, view);
  });
}

/**
 * Changes the view's sheet overlay: in the store while it holds it, so edits that follow build on the change,
 * else in the file alone, which also works while another campaign holds the store.
 */
export function updatePlayerSheet(
  campaignId: string,
  view: string,
  change: (overlay: PlayerSheetOverlay) => PlayerSheetOverlay,
): Promise<void> {
  const { repository } = useAppStore.getState();
  const state = usePlayerDataStore.getState();
  const held = state.campaignId === campaignId ? state.overlays[view] : undefined;
  return held
    ? storePlayerSheet(campaignId, view, change(held))
    : queueWrite(campaignId, view, async () => {
        // A load queued before this one may have filled the store by now.
        const now = usePlayerDataStore.getState();
        const loaded = now.campaignId === campaignId ? now.overlays[view] : undefined;
        const next = change(loaded ?? (await repository.loadPlayerSheet(campaignId, view)));
        if (loaded) {
          usePlayerDataStore.setState((s) => ({ overlays: { ...s.overlays, [view]: next } }));
        }
        await repository.storePlayerSheet(campaignId, view, next);
      });
}

/** Writes the waiting edits of `view` as the store holds them when the write runs, after any load. */
function writePending(campaignId: string, view: string): void {
  const { repository, reportError } = useAppStore.getState();
  void ensurePlayerData(campaignId, view);
  queueWrite(campaignId, view, async () => {
    const state = usePlayerDataStore.getState();
    // After a campaign switch the store no longer holds this queue; the
    // file keeps what it had.
    if (state.campaignId === campaignId) {
      const edits = state.pending.filter((p) => p.view === view).map(({ view: _view, ...edit }) => edit);
      await repository.storePlayerPending(campaignId, view, edits);
    }
  }).catch(reportError);
}

/** Queues a player's edit for the DM and its file; a newer edit of the same value replaces a queued one. */
export function queueSheetEdit(campaignId: string, view: string, edit: PendingSheetEdit): void {
  switchCampaign(campaignId);
  const target = sheetEditTarget(edit.edit);
  usePlayerDataStore.setState((s) => ({
    pending: [...s.pending.filter((p) => p.view !== view || sheetEditTarget(p.edit) !== target), { ...edit, view }],
  }));
  writePending(campaignId, view);
}

/** Takes a waiting edit off the queue and its file; undefined when it is gone. */
export function takeSheetEdit(id: string): PendingViewEdit | undefined {
  const { campaignId, pending } = usePlayerDataStore.getState();
  const taken = pending.find((p) => p.id === id);
  if (taken && campaignId !== null) {
    usePlayerDataStore.setState((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
    writePending(campaignId, taken.view);
  }
  return taken;
}

/** `settles`: the sheet edit the notice answers for good (accepted, declined, refused or withdrawn). */
type NoticeSender = (view: string, text: string, settles?: SheetEdit) => void;
const noticeSenders = new Set<NoticeSender>();

/** Lets a publisher deliver `notice` messages that arise outside a player's request, e.g. a DM's approval. */
export function onPlayerNotice(send: NoticeSender): () => void {
  noticeSenders.add(send);
  return () => {
    noticeSenders.delete(send);
  };
}

export function sendPlayerNotice(view: string, text: string, settles?: SheetEdit): void {
  for (const send of noticeSenders) {
    send(view, text, settles);
  }
}

/** Forgets the loaded views, for tests and a fresh start. */
export function resetPlayerData(): void {
  requested = { campaignId: null, views: new Map() };
  writes.clear();
  usePlayerDataStore.setState({ campaignId: null, notes: {}, overlays: {}, pending: [] });
}
