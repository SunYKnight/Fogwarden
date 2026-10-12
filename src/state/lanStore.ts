import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { WebSocketTransport } from '@/sync/wsTransport';

/** Tauri event carrying the number of connected players. */
const PLAYERS_EVENT = 'lan-players';

/** Mirrors `LanInfo` in `src-tauri/src/lan.rs`. */
export interface LanInfo {
  port: number;
  /** Player view URLs, LAN addresses first, localhost last. */
  urls: string[];
  token: string;
  /** Loopback WebSocket URL with the DM token. */
  dmUrl: string;
  players: number;
}

interface LanState {
  info: LanInfo | null;
  /** DM side of the relay while the server runs; the publisher fans out to it. */
  transport: WebSocketTransport | null;
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  /** Picks up a server that outlived a reload of the DM window. */
  refresh(): Promise<void>;
}

export const useLanStore = create<LanState>((set, get) => {
  let unlistenPlayers: Promise<UnlistenFn> | null = null;

  const connect = (info: LanInfo | null) => {
    const current = get().transport;
    if (info && !current) {
      unlistenPlayers = listen<number>(PLAYERS_EVENT, (event) =>
        set((s) => (s.info ? { info: { ...s.info, players: event.payload } } : {})),
      );
      set({ info, transport: new WebSocketTransport(info.dmUrl, 'dm') });
    } else if (!info && current) {
      current.close();
      void unlistenPlayers?.then((unlisten) => unlisten());
      unlistenPlayers = null;
      set({ info, transport: null });
    } else {
      set({ info });
    }
  };

  return {
    info: null,
    transport: null,
    start: async (port) => connect(await invoke<LanInfo>('lan_start', { port })),
    stop: async () => {
      connect(null);
      await invoke<void>('lan_stop');
    },
    refresh: async () => {
      if (isTauri()) {
        connect(await invoke<LanInfo | null>('lan_status'));
      }
    },
  };
});
