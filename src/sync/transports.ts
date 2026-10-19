import { isTauri } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  SYNC_PROTOCOL_VERSION,
  type DmTransport,
  type PlayerRequest,
  type SyncMessage,
  type SyncPayload,
  type SyncTransport,
} from './protocol';

const REQUESTS: Record<PlayerRequest['type'], true> = {
  roll: true,
  point: true,
  move: true,
  chat: true,
  note: true,
  sheetEdit: true,
};

/** True for the payloads players send besides `hello`. */
export function isPlayerRequest(payload: SyncPayload): payload is PlayerRequest {
  return REQUESTS[payload.type as PlayerRequest['type']] === true;
}

const CHANNEL = 'fogwarden-sync';

export type Role = SyncMessage['from'];

/** True for current-protocol messages sent by the other side. */
export function accept(message: { protocol: number; from: Role }, role: Role): boolean {
  return message.protocol === SYNC_PROTOCOL_VERSION && message.from !== role;
}

/** Between the DM and player windows of the desktop app. */
export class TauriEventTransport implements SyncTransport {
  private readonly unlisteners: Promise<UnlistenFn>[] = [];

  constructor(private readonly role: Role) {}

  send(payload: SyncPayload): void {
    const message: SyncMessage = { protocol: SYNC_PROTOCOL_VERSION, from: this.role, payload };
    void emit(CHANNEL, message);
  }

  subscribe(handler: (payload: SyncPayload) => void): () => void {
    const unlisten = listen<SyncMessage>(CHANNEL, (event) => {
      if (accept(event.payload, this.role)) {
        handler(event.payload.payload);
      }
    });
    this.unlisteners.push(unlisten);
    return () => void unlisten.then((fn) => fn());
  }

  close(): void {
    for (const unlisten of this.unlisteners) {
      void unlisten.then((fn) => fn());
    }
  }
}

/** Between tabs of the same origin when the UI runs in a plain browser. */
export class BroadcastChannelTransport implements SyncTransport {
  private readonly channel = new BroadcastChannel(CHANNEL);

  constructor(private readonly role: Role) {}

  send(payload: SyncPayload): void {
    const message: SyncMessage = { protocol: SYNC_PROTOCOL_VERSION, from: this.role, payload };
    this.channel.postMessage(message);
  }

  subscribe(handler: (payload: SyncPayload) => void): () => void {
    const listener = (event: MessageEvent<SyncMessage>) => {
      if (accept(event.data, this.role)) {
        handler(event.data.payload);
      }
    };
    this.channel.addEventListener('message', listener);
    return () => this.channel.removeEventListener('message', listener);
  }

  close(): void {
    this.channel.close();
  }
}

export function createLocalTransport(role: Role): SyncTransport {
  return isTauri() ? new TauriEventTransport(role) : new BroadcastChannelTransport(role);
}

/**
 * DM side of the player window: it shows one view, chosen by the DM, or none while it is closed. Choosing
 * another view asks the publisher for a full resend of it.
 */
export class LocalViewTransport implements DmTransport {
  private readonly resendHandlers = new Set<(view: string | null) => void>();
  private readonly viewHandlers = new Set<(views: ReadonlySet<string>) => void>();
  private view: string | null = null;

  constructor(private readonly transport: SyncTransport) {}

  /** The window's view, or null while no window shows anything. */
  setView(view: string | null): void {
    if (view !== this.view) {
      this.view = view;
      const views = new Set(view === null ? [] : [view]);
      for (const handler of this.viewHandlers) {
        handler(views);
      }
      for (const handler of view === null ? [] : this.resendHandlers) {
        handler(view);
      }
    }
  }

  send(views: readonly string[], payload: SyncPayload): void {
    if (this.view !== null && views.includes(this.view)) {
      this.transport.send(payload);
    }
  }

  onResend(handler: (view: string | null) => void): () => void {
    this.resendHandlers.add(handler);
    const unsubscribe = this.transport.subscribe((payload) => {
      // A window that just opened knows nothing yet.
      if (payload.type === 'hello' && this.view !== null) {
        handler(this.view);
      }
    });
    return () => {
      this.resendHandlers.delete(handler);
      unsubscribe();
    };
  }

  // The window is the app's own, so its requests count for the view it shows.
  onPlayerRequest(handler: (view: string, request: PlayerRequest) => void): () => void {
    return this.transport.subscribe((payload) => {
      if (this.view !== null && isPlayerRequest(payload)) {
        handler(this.view, payload);
      }
    });
  }

  watchViews(handler: (views: ReadonlySet<string>) => void): () => void {
    this.viewHandlers.add(handler);
    handler(new Set(this.view === null ? [] : [this.view]));
    return () => this.viewHandlers.delete(handler);
  }

  close(): void {
    this.transport.close();
  }
}
