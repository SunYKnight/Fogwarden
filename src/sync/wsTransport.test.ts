import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_PROTOCOL_VERSION, type SyncMessage, type SyncPayload } from './protocol';
import type { Role } from './transports';
import { RECONNECT_DELAYS_MS, WebSocketTransport } from './wsTransport';

class FakeSocket {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: SyncMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as SyncMessage);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  receive(from: Role, payload: SyncPayload, protocol: number = SYNC_PROTOCOL_VERSION): void {
    this.onmessage?.({ data: JSON.stringify({ protocol, from, payload }) });
  }
}

const hello: SyncMessage = { protocol: SYNC_PROTOCOL_VERSION, from: 'player', payload: { type: 'hello' } };
const map: SyncPayload = { type: 'map', revision: 1, map: null };

function setup(role: Role) {
  const sockets: FakeSocket[] = [];
  const transport = new WebSocketTransport('ws://dm.test/ws?token=t', role, () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const received: SyncPayload[] = [];
  transport.subscribe((payload) => received.push(payload));
  return { transport, sockets, received };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WebSocketTransport', () => {
  it('player says hello on every connect, including reconnects', () => {
    const { sockets } = setup('player');
    sockets[0]!.open();
    expect(sockets[0]!.sent).toEqual([hello]);

    sockets[0]!.close();
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]! - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([hello]);
  });

  it('backs off while the server is unreachable and resets after a successful connect', () => {
    const { sockets } = setup('player');
    const waits: number[] = [];
    for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length + 1; attempt += 1) {
      const before = sockets.length;
      sockets.at(-1)!.close();
      const started = Date.now();
      vi.advanceTimersToNextTimer();
      expect(sockets).toHaveLength(before + 1);
      waits.push(Date.now() - started);
    }
    expect(waits).toEqual([...RECONNECT_DELAYS_MS, RECONNECT_DELAYS_MS.at(-1)]);

    sockets.at(-1)!.open();
    sockets.at(-1)!.close();
    const started = Date.now();
    vi.advanceTimersToNextTimer();
    expect(Date.now() - started).toBe(RECONNECT_DELAYS_MS[0]);
  });

  it('drops messages sent while disconnected instead of sending them late', () => {
    const { transport, sockets } = setup('dm');
    transport.send(map);
    sockets[0]!.open();
    expect(sockets[0]!.sent).toEqual([]);
    transport.send(map);
    expect(sockets[0]!.sent).toEqual([{ protocol: SYNC_PROTOCOL_VERSION, from: 'dm', payload: map }]);
  });

  it('DM hears a local hello on every connect so its publisher resends', () => {
    const { sockets, received } = setup('dm');
    sockets[0]!.open();
    sockets[0]!.close();
    vi.advanceTimersToNextTimer();
    sockets[1]!.open();
    expect(received).toEqual([{ type: 'hello' }, { type: 'hello' }]);
    expect(sockets[1]!.sent).toEqual([]);
  });

  it('delivers only current-protocol messages from the other side', () => {
    const { sockets, received } = setup('player');
    sockets[0]!.open();
    sockets[0]!.receive('dm', map);
    sockets[0]!.receive('player', { type: 'hello' });
    sockets[0]!.receive('dm', map, SYNC_PROTOCOL_VERSION + 1);
    expect(received).toEqual([map]);
  });

  it('stops reconnecting once closed, also with a retry pending', () => {
    const open = setup('player');
    open.sockets[0]!.open();
    open.transport.close();
    vi.runAllTimers();
    expect(open.sockets).toHaveLength(1);

    const retrying = setup('player');
    retrying.sockets[0]!.close();
    retrying.transport.close();
    vi.runAllTimers();
    expect(retrying.sockets).toHaveLength(1);
  });
});
