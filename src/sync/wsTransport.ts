import {
  SYNC_PROTOCOL_VERSION,
  type DmTransport,
  type PlayerRequest,
  type SyncMessage,
  type SyncPayload,
  type SyncTransport,
} from './protocol';
import { parseViewFrame, RELAY_LINK_REVOKED, relayStatusSchema, viewFrame, type RelayStatus } from './relayApi';
import { accept, isPlayerRequest } from './transports';

/** Waits before reconnect attempt 1, 2, 3, …; the last value repeats. */
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];

const HELLO: SyncPayload = { type: 'hello' };

type CreateSocket = (url: string) => WebSocket;

/**
 * WebSocket that reconnects with backoff until closed, or until the server closes it because its link was
 * withdrawn. Text sent while disconnected is dropped.
 */
class ReconnectingSocket {
  private readonly connectionHandlers = new Set<(open: boolean) => void>();
  private socket: WebSocket | null = null;
  private attempts = 0;
  private retryTimer?: number;
  private closed = false;
  /** The server withdrew the link; no reconnect follows. */
  revoked = false;

  constructor(
    private readonly url: string,
    private readonly createSocket: CreateSocket,
    private readonly events: { open(): void; text(data: string): void },
  ) {
    this.connect();
  }

  private connect(): void {
    const socket = this.createSocket(this.url);
    socket.onopen = () => {
      this.attempts = 0;
      this.notifyConnection(true);
      this.events.open();
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'string') {
        throw new Error('Player view sync expects text messages');
      }
      this.events.text(event.data);
    };
    socket.onclose = (event: CloseEvent) => this.reconnect(socket, event.code);
    this.socket = socket;
  }

  private reconnect(socket: WebSocket, code: number): void {
    if (!this.closed && socket === this.socket) {
      this.revoked = code === RELAY_LINK_REVOKED;
      this.closed = this.revoked;
      this.notifyConnection(false);
      const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)];
      this.attempts += 1;
      this.retryTimer = this.revoked ? undefined : window.setTimeout(() => this.connect(), delay);
    }
  }

  private notifyConnection(open: boolean): void {
    for (const handler of this.connectionHandlers) {
      handler(open);
    }
  }

  send(text: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(text);
    }
  }

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

/**
 * Player side of the LAN server's or the relay's `/ws`. Every (re)connect announces itself with `hello`, which
 * makes the DM resend everything of this link's view.
 */
export class WebSocketTransport implements SyncTransport {
  private readonly handlers = new Set<(payload: SyncPayload) => void>();
  private readonly socket: ReconnectingSocket;

  constructor(url: string, createSocket: CreateSocket = (u) => new WebSocket(u)) {
    this.socket = new ReconnectingSocket(url, createSocket, {
      open: () => this.send(HELLO),
      text: (data) => {
        const message = JSON.parse(data) as SyncMessage;
        if (accept(message, 'player')) {
          for (const handler of this.handlers) {
            handler(message.payload);
          }
        }
      },
    });
  }

  /** The DM withdrew this link; the transport stays closed. */
  get revoked(): boolean {
    return this.socket.revoked;
  }

  send(payload: SyncPayload): void {
    const message: SyncMessage = { protocol: SYNC_PROTOCOL_VERSION, from: 'player', payload };
    this.socket.send(JSON.stringify(message));
  }

  subscribe(handler: (payload: SyncPayload) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Calls `handler` with whether the socket is open: now and on every connect and disconnect. */
  watchConnection(handler: (open: boolean) => void): () => void {
    return this.socket.watchConnection(handler);
  }

  close(): void {
    this.socket.close();
  }
}

type RelayCounts = RelayStatus['relay'];

/**
 * DM side of the LAN server's or the relay's `/ws`: messages go out as view frames, players' hellos and requests
 * come back per view, and status frames tell which views have players. The first status after every (re)connect
 * asks for a resend to all of them, since players may have missed messages while the DM was away.
 */
export class ViewSocketTransport implements DmTransport {
  private readonly resendHandlers = new Set<(view: string | null) => void>();
  private readonly requestHandlers = new Set<(view: string, request: PlayerRequest) => void>();
  private readonly viewHandlers = new Set<(views: ReadonlySet<string>) => void>();
  private readonly statusHandlers = new Set<(status: RelayCounts) => void>();
  private readonly socket: ReconnectingSocket;
  private views: ReadonlySet<string> = new Set();
  private status: RelayCounts = { players: 0, views: {} };
  private reconnected = false;

  constructor(url: string, createSocket: CreateSocket) {
    this.socket = new ReconnectingSocket(url, createSocket, {
      open: () => {
        this.reconnected = true;
      },
      text: (data) => this.receive(data),
    });
    this.socket.watchConnection((open) => {
      if (!open) {
        this.setStatus({ players: 0, views: {} });
      }
    });
  }

  private receive(data: string): void {
    const frame = parseViewFrame(data);
    const message = frame ? (JSON.parse(frame.message) as SyncMessage) : null;
    const payload = frame && message && accept(message, 'dm') ? message.payload : null;
    if (frame && payload?.type === 'hello') {
      this.resend(frame.views[0]!);
    } else if (frame && payload && isPlayerRequest(payload)) {
      for (const handler of this.requestHandlers) {
        handler(frame.views[0]!, payload);
      }
    } else if (!frame) {
      this.setStatus(relayStatusSchema.parse(JSON.parse(data)).relay);
      if (this.reconnected) {
        this.reconnected = false;
        this.resend(null);
      }
    }
  }

  private setStatus(status: RelayCounts): void {
    const views = new Set(Object.keys(status.views));
    const viewsChanged = views.size !== this.views.size || [...views].some((v) => !this.views.has(v));
    this.status = status;
    if (viewsChanged) {
      this.views = views;
      for (const handler of this.viewHandlers) {
        handler(views);
      }
    }
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }

  private resend(view: string | null): void {
    for (const handler of this.resendHandlers) {
      handler(view);
    }
  }

  send(views: readonly string[], payload: SyncPayload): void {
    const targets = views.filter((view) => this.views.has(view));
    if (targets.length > 0) {
      const message: SyncMessage = { protocol: SYNC_PROTOCOL_VERSION, from: 'dm', payload };
      this.socket.send(viewFrame(targets, JSON.stringify(message)));
    }
  }

  onResend(handler: (view: string | null) => void): () => void {
    this.resendHandlers.add(handler);
    return () => this.resendHandlers.delete(handler);
  }

  onPlayerRequest(handler: (view: string, request: PlayerRequest) => void): () => void {
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  watchViews(handler: (views: ReadonlySet<string>) => void): () => void {
    this.viewHandlers.add(handler);
    handler(this.views);
    return () => this.viewHandlers.delete(handler);
  }

  /** Calls `handler` with the player counts: now and whenever the server reports them. */
  watchStatus(handler: (status: RelayCounts) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  watchConnection(handler: (open: boolean) => void): () => void {
    return this.socket.watchConnection(handler);
  }

  close(): void {
    this.socket.close();
  }
}
