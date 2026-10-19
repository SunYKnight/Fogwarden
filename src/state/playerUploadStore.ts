import { create } from 'zustand';
import type { AssetRef, Campaign, DocRef } from '@/core/model';
import { storePlayerUpload, type PlayerUploadSource } from '@/sync/playerUploads';
import type { PlayerUpload } from '@/sync/relayApi';
import { useViewLinksStore } from '@/sync/views';
import { useAppStore } from './appStore';
import { useEncounterStore } from './encounterStore';
import { useLanStore } from './lanStore';
import { useLibraryStore } from './libraryStore';
import { useRelayStore } from './relayStore';

export type UploadServer = 'lan' | 'relay';

/** A picture waiting on a server for the DM to accept or reject it. */
export interface PendingUpload extends PlayerUpload {
  server: UploadServer;
}

/** A picture the DM accepted this session; the DM may make it the character's portrait or token. */
export interface AcceptedUpload {
  id: string;
  view: string;
  name: string;
  ref: AssetRef;
}

interface PlayerUploadState {
  /** Oldest first. */
  pending: PendingUpload[];
  /** Newest first. */
  accepted: AcceptedUpload[];
}

export const usePlayerUploadStore = create<PlayerUploadState>(() => ({ pending: [], accepted: [] }));

function sourceOf(server: UploadServer): PlayerUploadSource {
  const source = server === 'lan' ? useLanStore.getState().transport : useRelayStore.getState().transport;
  if (!source) {
    throw new Error(server === 'lan' ? 'The LAN server is not running.' : 'The online server is not connected.');
  }
  return source;
}

/** Name of the character a view shows, for notices and the review list. */
export function viewName(view: string): string {
  return useViewLinksStore.getState().linked.find((v) => v.id === view)?.name ?? view;
}

/**
 * Follows the uploads waiting on the LAN server and the relay while either runs, and tells the DM about each
 * new one once per session.
 */
export function startPlayerUploads(): () => void {
  const byServer: Record<UploadServer, PendingUpload[]> = { lan: [], relay: [] };
  const announced = new Set<string>();
  const none = { source: null, stop: () => undefined };
  const watching: Record<UploadServer, { source: PlayerUploadSource | null; stop: () => void }> = {
    lan: none,
    relay: none,
  };

  const update = (server: UploadServer, uploads: readonly PlayerUpload[]) => {
    byServer[server] = uploads.map((upload) => ({ ...upload, server }));
    usePlayerUploadStore.setState({ pending: [...byServer.lan, ...byServer.relay].sort((a, b) => a.at - b.at) });
    for (const upload of uploads.filter((u) => !announced.has(u.id))) {
      announced.add(upload.id);
      useAppStore.getState().notify(`${viewName(upload.view)} sent a picture; review it under Players`, 'info');
    }
  };

  const follow = (server: UploadServer, source: PlayerUploadSource | null) => {
    if (source !== watching[server].source) {
      watching[server].stop();
      const stop = source ? source.watchUploads((uploads) => update(server, uploads)) : () => undefined;
      watching[server] = { source, stop };
      if (!source) update(server, []);
    }
  };

  follow('lan', useLanStore.getState().transport);
  follow('relay', useRelayStore.getState().transport);
  const unsubscribers = [
    useLanStore.subscribe((state) => follow('lan', state.transport)),
    useRelayStore.subscribe((state) => follow('relay', state.transport)),
  ];
  return () => {
    for (const unsubscribe of [...unsubscribers, watching.lan.stop, watching.relay.stop]) {
      unsubscribe();
    }
  };
}

/** The picture's bytes for the DM's preview; nothing is stored. */
export function fetchPendingUpload({
  server,
  id,
}: Pick<PendingUpload, 'server' | 'id'>): Promise<Uint8Array<ArrayBuffer>> {
  return sourceOf(server).fetchUpload(id);
}

/**
 * Stores the picture in the linked campaign's `players/<view>/uploads/` and deletes it on the server. Refused
 * without a campaign, or for a character of another one, since the picture belongs into its campaign's folder.
 */
export async function acceptPlayerUpload(upload: PendingUpload): Promise<AcceptedUpload> {
  const { campaignId, linked } = useViewLinksStore.getState();
  if (campaignId === null) {
    throw new Error('Open an encounter of the campaign first: accepted pictures are kept in its folder.');
  }
  if (!linked.some((v) => v.id === upload.view)) {
    throw new Error(`"${upload.name}" comes from a character of another campaign; open one of its encounters.`);
  }
  const source = sourceOf(upload.server);
  const bytes = await source.fetchUpload(upload.id);
  const ref = await storePlayerUpload(useAppStore.getState().repository.storage, campaignId, upload, bytes);
  await source.deleteUpload(upload.id);
  const accepted: AcceptedUpload = { id: upload.id, view: upload.view, name: upload.name, ref };
  usePlayerUploadStore.setState((s) => ({ accepted: [accepted, ...s.accepted.filter((a) => a.id !== upload.id)] }));
  return accepted;
}

/** Deletes the picture on the server without keeping it. */
export function rejectPlayerUpload(upload: PendingUpload): Promise<void> {
  return sourceOf(upload.server).deleteUpload(upload.id);
}

/** Library creature a view plays: its player character in the open encounter, else the campaign's party member. */
async function creatureOfView(view: string): Promise<DocRef | null> {
  const { encounter } = useEncounterStore.getState();
  const playing = encounter?.combatants.find((c) => c.id === view && c.side === 'player')?.creature ?? null;
  const { campaignId } = useViewLinksStore.getState();
  const campaigns: Campaign[] = playing ? [] : (await useAppStore.getState().repository.listCampaigns()).campaigns;
  const member = campaigns.find((c) => c.id === campaignId)?.party.find((m) => m.id === view);
  return playing ?? member?.creature ?? null;
}

/**
 * Makes an accepted picture the character's portrait (`image`) or token picture through the creature's own
 * picture files, so every encounter shows it and the players get it like any other token picture.
 */
export async function applyPlayerPicture(accepted: AcceptedUpload, kind: 'image' | 'token'): Promise<void> {
  const creature = await creatureOfView(accepted.view);
  if (!creature) {
    throw new Error(`${viewName(accepted.view)} has no compendium character to take the picture.`);
  }
  const { repository } = useAppStore.getState();
  const bytes = await repository.storage.readBytes('data', accepted.ref.path);
  await repository.importCreaturePicture(creature.id, kind, accepted.ref.path, bytes);
  await useLibraryStore.getState().refresh('creature');
}
