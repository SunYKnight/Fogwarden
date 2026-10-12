import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { AssetRef } from '@/core/model';
import { RELAY_LINK_PARAM } from '@/sync/relayApi';
import { fetchRelaySession, relayBaseUrl, RelayTransport, RelayUploader } from '@/sync/relayClient';
import { useAppStore } from './appStore';

/** `connecting`: checking the key and uploading the player page; `reconnecting`: the socket dropped. */
export type RelayLink = 'off' | 'connecting' | 'online' | 'reconnecting';

interface RelayState {
  link: RelayLink;
  players: number;
  /** Link players open; null while disconnected. */
  playerUrl: string | null;
  lastError: string | null;
  /** DM side of the relay while connected; the publisher fans out to it. */
  transport: RelayTransport | null;
  connect(url: string, dmKey: string): Promise<void>;
  disconnect(): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export const useRelayStore = create<RelayState>((set, get) => ({
  link: 'off',
  players: 0,
  playerUrl: null,
  lastError: null,
  transport: null,
  connect: async (url, dmKey) => {
    get().disconnect();
    set({ link: 'connecting', lastError: null });
    try {
      const baseUrl = relayBaseUrl(url);
      const session = await fetchRelaySession(baseUrl, dmKey);
      const uploader = new RelayUploader(baseUrl, dmKey, readAsset);
      await uploader.uploadBundle(readFrontendFile);
      const transport = new RelayTransport(baseUrl, dmKey, uploader, {
        status: ({ relay }) => set({ players: relay.players }),
        uploadFailed: (error) => {
          set({ lastError: errorText(error) });
          useAppStore.getState().reportError(error);
        },
      });
      transport.watchConnection((open) => {
        if (get().transport === transport) {
          set({ link: open ? 'online' : 'reconnecting' });
        }
      });
      set({ transport, players: session.players, playerUrl: `${baseUrl}/?${RELAY_LINK_PARAM}=${session.token}` });
    } catch (error) {
      set({ link: 'off', lastError: errorText(error) });
      throw error;
    }
  },
  disconnect: () => {
    get().transport?.close();
    set({ link: 'off', players: 0, playerUrl: null, transport: null });
  },
}));
