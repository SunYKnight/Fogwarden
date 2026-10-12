import { SYNC_PROTOCOL_VERSION, type SyncMessage, type SyncPayload, type SyncTransport } from './protocol';
import { accept, type Role } from './transports';

/** Waits before reconnect attempt 1, 2, 3, …; the last value repeats. */
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];

const HELLO: SyncPayload = { type: 'hello' };

/**
 * Through the LAN server's `/ws` relay (`src-tauri/src/lan.rs`). Reconnects until closed. Messages sent while
 * disconnected are dropped: every (re)connect announces itself with `hello`, which makes the DM resend everything.
 */
export class WebSocketTransport implements SyncTransport {
  private readonly handlers = new Set<(payload: SyncPayload) => void>();
  private readonly connectionHandlers = new Set<(open: boolean) => void>();
  private socket: WebSocket | null = null;
  private attempts = 0;
  private retryTimer?: number;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly role: Role,
    private readonly createSocket: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {
    this.connect();
  }

  private connect(): void {
    const socket = this.createSocket(this.url);
    socket.onopen = () => {
      this.attempts = 0;
      this.notifyConnection(true);
      this.announce();
    };
    socket.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    socket.onclose = () => this.reconnect(socket);
    this.socket = socket;
  }

  // A player asks the DM for a resend; the DM's players may have missed what
  // it sent while disconnected, so its own publisher hears a hello instead.
  private announce(): void {
    if (this.role === 'player') {
      this.send(HELLO);
    } else {
      this.deliver(HELLO);
    }
  }

  private reconnect(socket: WebSocket): void {
    if (!this.closed && socket === this.socket) {
      this.notifyConnection(false);
      const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)];
      this.attempts += 1;
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') {
      throw new Error('LAN sync expects text messages');
    }
    const message = JSON.parse(data) as SyncMessage;
    if (accept(message, this.role)) {
      this.deliver(message.payload);
    }
  }

  private deliver(payload: SyncPayload): void {
    for (const handler of this.handlers) {
      handler(payload);
    }
  }

  private notifyConnection(open: boolean): void {
    for (const handler of this.connectionHandlers) {
      handler(open);
    }
  }

  send(payload: SyncPayload): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      const message: SyncMessage = { protocol: SYNC_PROTOCOL_VERSION, from: this.role, payload };
      this.socket.send(JSON.stringify(message));
    }
  }

  subscribe(handler: (payload: SyncPayload) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Calls `handler` with whether the socket is open: now and on every connect and disconnect. */
  watchConnection(handler: (open: boolean) => void): () => void {
    this.connectionHandlers.add(handler);
    handler(this.socket?.readyState === WebSocket.OPEN);
    return () => this.connectionHandlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    this.socket?.close();
  }
}
