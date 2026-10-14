import { invoke, isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { linkTable, useViewLinksStore } from '@/sync/views';
import { ViewSocketTransport } from '@/sync/wsTransport';
import { useAppStore } from './appStore';

/** Mirrors `LanInfo` in `src-tauri/src/lan.rs`. */
export interface LanInfo {
  port: number;
  /** Base URLs of the server, LAN addresses first, localhost last; player links add `/player.html?token=`. */
  hosts: string[];
  /** Loopback WebSocket URL with the DM token. */
  dmUrl: string;
  players: number;
}

interface LanState {
  info: LanInfo | null;
  /** DM side of the relay while the server runs; the publisher fans out to it. */
  transport: ViewSocketTransport | null;
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  /** Picks up a server that outlived a reload of the DM window. */
  refresh(): Promise<void>;
}

export const useLanStore = create<LanState>((set, get) => {
  let unsubscribers: (() => void)[] = [];
  // Pushes run one after another, each sending the table current when it
  // starts, so an older table never lands after a newer one.
  let pushes: Promise<void> = Promise.resolve();

  const pushLinks = () => {
    pushes = pushes
      .then(() => invoke<void>('lan_set_links', { links: linkTable(useViewLinksStore.getState()) }))
      .catch(useAppStore.getState().reportError);
  };

  const connect = (info: LanInfo | null) => {
    const current = get().transport;
    if (info && !current) {
      const transport = new ViewSocketTransport(info.dmUrl, (url) => new WebSocket(url));
      unsubscribers = [
        transport.watchStatus(({ players }) => set((s) => (s.info ? { info: { ...s.info, players } } : {}))),
        useViewLinksStore.subscribe((state, previous) => {
          if (state.tokens !== previous.tokens || state.linked !== previous.linked) pushLinks();
        }),
      ];
      set({ info, transport });
      // A server that outlived a reload may hold links from before it.
      pushLinks();
    } else if (!info && current) {
      current.close();
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      unsubscribers = [];
      set({ info, transport: null });
    } else {
      set({ info });
    }
  };

  return {
    info: null,
    transport: null,
    start: async (port) =>
      connect(await invoke<LanInfo>('lan_start', { port, links: linkTable(useViewLinksStore.getState()) })),
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
