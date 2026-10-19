import { invoke, isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { MirrorChannel } from '@/sync/dmMirror';
import type { PlayerUploadSource } from '@/sync/playerUploads';
import { linkTable, linkToken, uploadViews, useViewLinksStore } from '@/sync/views';
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

// Frames of the remote DM channel; mirror `REMOTE_DM_*` in `lan.rs`.
const REMOTE_DM_PREFIX = '@dm\n';
const REMOTE_DM_COUNT = '@dm-count\n';
/** Link "view" the DM link token derives from; '@' is never part of a player view. */
const REMOTE_DM_LINK = '@remote-dm';

/**
 * DM side of the LAN server: its socket, the player uploads it holds (read in-process through commands) and the
 * channel to the remote DMs, which share the socket as `@dm` frames.
 */
class LanTransport extends ViewSocketTransport implements PlayerUploadSource {
  private readonly remoteDmHandlers = new Set<(text: string) => void>();
  private readonly remoteDmCountHandlers = new Set<(count: number) => void>();
  private remoteDmCount = 0;

  /**
   * Open while a remote DM is connected: the mirror sends nothing without one, as encounter snapshots and maps
   * are large.
   */
  readonly remoteDms: MirrorChannel = {
    send: (text) => {
      if (this.remoteDmCount > 0) this.socket.send(`${REMOTE_DM_PREFIX}${text}`);
    },
    onText: (handler) => {
      this.remoteDmHandlers.add(handler);
      return () => this.remoteDmHandlers.delete(handler);
    },
    watchConnection: (handler) => {
      let open = this.remoteDmCount > 0;
      handler(open);
      return this.watchRemoteDms((count) => {
        if (open !== count > 0) {
          open = count > 0;
          handler(open);
        }
      });
    },
  };

  constructor(url: string, createSocket: (url: string) => WebSocket) {
    super(url, createSocket);
    // The server counts again for the next connection.
    this.watchConnection((open) => !open && this.setRemoteDmCount(0));
  }

  private setRemoteDmCount(count: number): void {
    this.remoteDmCount = count;
    for (const handler of this.remoteDmCountHandlers) {
      handler(count);
    }
  }

  protected override receive(data: string): void {
    if (data.startsWith(REMOTE_DM_PREFIX)) {
      const text = data.slice(REMOTE_DM_PREFIX.length);
      for (const handler of this.remoteDmHandlers) {
        handler(text);
      }
    } else if (data.startsWith(REMOTE_DM_COUNT)) {
      this.setRemoteDmCount(Number(data.slice(REMOTE_DM_COUNT.length)));
    } else {
      super.receive(data);
    }
  }

  /** Calls `handler` with the number of connected remote DMs: now and whenever it changes. */
  watchRemoteDms(handler: (count: number) => void): () => void {
    this.remoteDmCountHandlers.add(handler);
    handler(this.remoteDmCount);
    return () => this.remoteDmCountHandlers.delete(handler);
  }

  async fetchUpload(id: string): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await invoke<ArrayBuffer>('lan_player_upload', { id }));
  }

  deleteUpload(id: string): Promise<void> {
    return invoke<void>('lan_delete_player_upload', { id });
  }
}

interface LanState {
  info: LanInfo | null;
  /** DM side of the relay while the server runs; the publisher fans out to it. */
  transport: LanTransport | null;
  /** Token of the DM link while it is on and the server knows it; the link is `/dm.html?token=`. */
  dmToken: string | null;
  /** Remote DMs connected right now. */
  remoteDms: number;
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  /** Picks up a server that outlived a reload of the DM window. */
  refresh(): Promise<void>;
}

/** The DM link's token while the DM link is on and the link secret exists, else null. */
async function dmLinkToken(): Promise<string | null> {
  const settings = useAppStore.getState().settings;
  const secret = settings?.playerLinks.secret ?? '';
  const on = settings?.dmRemote.enabled === true && secret !== '';
  return on ? linkToken(secret, REMOTE_DM_LINK, settings.dmRemote.rotation) : null;
}

/** What the LAN server checks links, uploads and the DM link against. */
async function linkArgs() {
  const links = useViewLinksStore.getState();
  return { links: linkTable(links), uploads: uploadViews(links), remoteDm: await dmLinkToken() };
}

export const useLanStore = create<LanState>((set, get) => {
  let unsubscribers: (() => void)[] = [];
  // Pushes run one after another, each sending the table current when it
  // starts, so an older table never lands after a newer one.
  let pushes: Promise<void> = Promise.resolve();

  const pushLinks = () => {
    pushes = pushes
      .then(async () => {
        const args = await linkArgs();
        await invoke<void>('lan_set_links', args);
        set({ dmToken: args.remoteDm });
      })
      .catch(useAppStore.getState().reportError);
  };

  const connect = (info: LanInfo | null, dmToken: string | null) => {
    const current = get().transport;
    if (info && !current) {
      const transport = new LanTransport(info.dmUrl, (url) => new WebSocket(url));
      unsubscribers = [
        transport.watchStatus(({ players }) => set((s) => (s.info ? { info: { ...s.info, players } } : {}))),
        transport.watchRemoteDms((remoteDms) => set({ remoteDms })),
        useViewLinksStore.subscribe((state, previous) => {
          const changed = state.tokens !== previous.tokens || state.linked !== previous.linked;
          if (changed || state.features !== previous.features) pushLinks();
        }),
        useAppStore.subscribe((state, previous) => {
          const before = previous.settings;
          const after = state.settings;
          const changed = after?.dmRemote !== before?.dmRemote;
          if (changed || after?.playerLinks.secret !== before?.playerLinks.secret) pushLinks();
        }),
      ];
      set({ info, transport, dmToken });
      // A server that outlived a reload may hold links from before it.
      pushLinks();
    } else if (!info && current) {
      current.close();
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      unsubscribers = [];
      set({ info, transport: null, dmToken: null, remoteDms: 0 });
    } else {
      set({ info });
    }
  };

  return {
    info: null,
    transport: null,
    dmToken: null,
    remoteDms: 0,
    start: async (port) => {
      const args = await linkArgs();
      connect(await invoke<LanInfo>('lan_start', { port, ...args }), args.remoteDm);
    },
    stop: async () => {
      connect(null, null);
      await invoke<void>('lan_stop');
    },
    refresh: async () => {
      if (isTauri()) {
        connect(await invoke<LanInfo | null>('lan_status'), null);
      }
    },
  };
});
