import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { errorMessage } from '@/core/errors';
import type { AssetRef } from '@/core/model';
import { fetchRelaySession, pushRelayLinks, relayBaseUrl, RelayTransport, RelayUploader } from '@/sync/relayClient';
import { linkTable, uploadViews, useViewLinksStore } from '@/sync/views';
import { useAppStore } from './appStore';

/** `connecting`: checking the key and uploading the player page; `reconnecting`: the socket dropped. */
export type RelayLink = 'off' | 'connecting' | 'online' | 'reconnecting';

interface RelayState {
  link: RelayLink;
  players: number;
  /** Relay origin player links start with; null while disconnected. */
  baseUrl: string | null;
  lastError: string | null;
  /** DM side of the relay while connected; the publisher fans out to it. */
  transport: RelayTransport | null;
  connect(url: string, dmKey: string): Promise<void>;
  disconnect(): void;
}

async function readAsset(ref: AssetRef): Promise<Uint8Array<ArrayBuffer>> {
  const url = await useAppStore.getState().repository.storage.assetUrl(ref);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot read ${ref.area}/${ref.path}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// Through Rust: dev builds serve the app from Vite, which has no built
// player page; the backend reads dist/ either way (see `frontend.rs`).
async function readFrontendFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await invoke<ArrayBuffer>('frontend_file', { path }));
}

export const useRelayStore = create<RelayState>((set, get) => {
  let unsubscribers: (() => void)[] = [];
  // Disconnect counts up, so a connect still uploading knows it was cancelled.
  let attempt = 0;
  // Pushes run one after another, each sending the table current when it
  // starts, so an older table never lands after a newer one.
  let pushes: Promise<void> = Promise.resolve();

  const reportError = (error: unknown) => {
    set({ lastError: errorMessage(error) });
    useAppStore.getState().reportError(error);
  };

  return {
    link: 'off',
    players: 0,
    baseUrl: null,
    lastError: null,
    transport: null,
    connect: async (url, dmKey) => {
      get().disconnect();
      const mine = attempt;
      set({ link: 'connecting', lastError: null });
      try {
        const baseUrl = relayBaseUrl(url);
        const session = await fetchRelaySession(baseUrl, dmKey);
        const uploader = new RelayUploader(baseUrl, dmKey, readAsset);
        await uploader.uploadBundle(readFrontendFile);
        const push = () => {
          const links = useViewLinksStore.getState();
          return pushRelayLinks(baseUrl, dmKey, linkTable(links), uploadViews(links));
        };
        await push();
        if (mine === attempt) {
          const transport = new RelayTransport(baseUrl, dmKey, uploader, reportError);
          const pushLinks = () => {
            pushes = pushes.then(push).catch(reportError);
          };
          unsubscribers = [
            transport.watchConnection((open) => {
              if (get().transport === transport) {
                set({ link: open ? 'online' : 'reconnecting' });
              }
            }),
            transport.watchStatus(({ players }) => set({ players })),
            useViewLinksStore.subscribe((state, previous) => {
              const changed = state.tokens !== previous.tokens || state.linked !== previous.linked;
              if (changed || state.features !== previous.features) pushLinks();
            }),
          ];
          set({ transport, players: session.players, baseUrl });
        }
      } catch (error) {
        if (mine === attempt) {
          set({ link: 'off', lastError: errorMessage(error) });
        }
        throw error;
      }
    },
    disconnect: () => {
      attempt++;
      get().transport?.close();
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      unsubscribers = [];
      set({ link: 'off', players: 0, baseUrl: null, transport: null });
    },
  };
});
