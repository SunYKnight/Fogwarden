import { isTauri } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SYNC_PROTOCOL_VERSION, type SyncMessage, type SyncPayload, type SyncTransport } from './protocol';

const CHANNEL = 'dm-tool-sync';

export type Role = SyncMessage['from'];

/** True for current-protocol messages sent by the other side. */
export function accept(message: SyncMessage, role: Role): boolean {
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
