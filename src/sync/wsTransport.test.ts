import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_PROTOCOL_VERSION, type SyncMessage, type SyncPayload } from './protocol';
import { RELAY_LINK_REVOKED } from './relayApi';
import { RECONNECT_DELAYS_MS, ViewSocketTransport, WebSocketTransport } from './wsTransport';

class FakeSocket {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code });
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  receive(text: string): void {
    this.onmessage?.({ data: text });
  }
}

const message = (from: SyncMessage['from'], payload: SyncPayload, protocol: number = SYNC_PROTOCOL_VERSION) =>
  JSON.stringify({ protocol, from, payload });
const hello = message('player', { type: 'hello' });
const map: SyncPayload = { type: 'map', revision: 1, map: null };

function fakeSockets() {
  const sockets: FakeSocket[] = [];
  const create = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  return { sockets, create };
}

function player() {
  const { sockets, create } = fakeSockets();
  const transport = new WebSocketTransport('ws://dm.test/ws?token=t', create);
  const received: SyncPayload[] = [];
  transport.subscribe((payload) => received.push(payload));
  return { transport, sockets, received };
}

function dm() {
  const { sockets, create } = fakeSockets();
  const transport = new ViewSocketTransport('ws://127.0.0.1/ws?token=d', create);
  const resends: (string | null)[] = [];
  const mapRevisions: (number | undefined)[] = [];
  const views: string[][] = [];
  transport.onResend((view, mapRevision) => {
    resends.push(view);
    mapRevisions.push(mapRevision);
  });
  transport.watchViews((active) => views.push([...active]));
  return { transport, sockets, resends, mapRevisions, views };
}

const status = (views: Record<string, number>) =>
  JSON.stringify({ relay: { players: Object.values(views).reduce((a, b) => a + b, 0), views } });

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
    const { sockets } = player();
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

  it('names the map it last delivered in the hello after a reconnect', () => {
    const { sockets } = player();
    sockets[0]!.open();
    sockets[0]!.receive(message('dm', { type: 'map', revision: 7, map: null }));
    sockets[0]!.close();
    vi.advanceTimersToNextTimer();
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([message('player', { type: 'hello', mapRevision: 7 })]);
  });

  it('refuses a message that is no sync message', () => {
    const { sockets } = player();
    sockets[0]!.open();
    expect(() => sockets[0]!.receive('null')).toThrow();
    expect(() => sockets[0]!.receive('{"protocol":2,"from":"dm","payload":7}')).toThrow();
  });

  it('backs off while the server is unreachable and resets after a successful connect', () => {
    const { sockets } = player();
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

  it('delivers only current-protocol messages from the DM', () => {
    const { sockets, received } = player();
    sockets[0]!.open();
    sockets[0]!.receive(message('dm', map));
    sockets[0]!.receive(message('player', { type: 'hello' }));
    sockets[0]!.receive(message('dm', map, SYNC_PROTOCOL_VERSION + 1));
    expect(received).toEqual([map]);
  });

  it('reports connects and disconnects to connection watchers', () => {
    const { transport, sockets } = player();
    const states: boolean[] = [];
    const stop = transport.watchConnection((open) => states.push(open));
    sockets[0]!.open();
    sockets[0]!.close();
    vi.advanceTimersToNextTimer();
    sockets[1]!.open();
    stop();
    sockets[1]!.close();
    expect(states).toEqual([false, true, false, true]);
  });

  it('stops reconnecting once closed, also with a retry pending', () => {
    const open = player();
    open.sockets[0]!.open();
    open.transport.close();
    vi.runAllTimers();
    expect(open.sockets).toHaveLength(1);

    const retrying = player();
    retrying.sockets[0]!.close();
    retrying.transport.close();
    vi.runAllTimers();
    expect(retrying.sockets).toHaveLength(1);
  });

  it('gives up for good when the server withdraws the link', () => {
    const { transport, sockets } = player();
    sockets[0]!.open();
    expect(transport.revoked).toBe(false);
    sockets[0]!.close(RELAY_LINK_REVOKED);
    vi.runAllTimers();
    expect(sockets).toHaveLength(1);
    expect(transport.revoked).toBe(true);
  });
});

describe('ViewSocketTransport', () => {
  it('sends view frames only for views with players and drops them while disconnected', () => {
    const { transport, sockets, views } = dm();
    transport.send(['party'], map);
    sockets[0]!.open();
    sockets[0]!.receive(status({ party: 1, thorin: 2 }));
    transport.send(['party', 'elara', 'thorin'], map);
    transport.send(['elara'], map);
    expect(sockets[0]!.sent).toEqual([`party,thorin\n${message('dm', map)}`]);
    expect(views).toEqual([[], ['party', 'thorin']]);

    sockets[0]!.close();
    expect(views.at(-1)).toEqual([]);
    transport.send(['party'], map);
    expect(sockets[0]!.sent).toHaveLength(1);
  });

  it('asks for a resend of one view on its hello and of all views after every reconnect', () => {
    const { sockets, resends, mapRevisions } = dm();
    sockets[0]!.open();
    sockets[0]!.receive(status({ party: 1 }));
    expect(resends).toEqual([null]);
    sockets[0]!.receive(`thorin\n${hello}`);
    sockets[0]!.receive(`elara\n${message('player', { type: 'hello', mapRevision: 7 })}`);
    sockets[0]!.receive(status({ party: 1, thorin: 1 }));
    expect(resends).toEqual([null, 'thorin', 'elara']);
    expect(mapRevisions).toEqual([undefined, undefined, 7]);

    sockets[0]!.close();
    vi.advanceTimersToNextTimer();
    sockets[1]!.open();
    sockets[1]!.receive(status({ party: 1 }));
    expect(resends).toEqual([null, 'thorin', 'elara', null]);
  });

  it("hands players' requests to the DM with the view they came from", () => {
    const { transport, sockets, resends } = dm();
    const requests: [string, SyncPayload][] = [];
    transport.onPlayerRequest((view, request) => requests.push([view, request]));
    sockets[0]!.open();
    const point: SyncPayload = { type: 'point', at: { x: 5, y: 5, elevationFt: 0 } };
    sockets[0]!.receive(`party\n${message('player', point)}`);
    sockets[0]!.receive(`thorin\n${message('player', { type: 'roll', dice: '1d20', mode: 'normal', label: '' })}`);
    expect(requests).toEqual([
      ['party', point],
      ['thorin', { type: 'roll', dice: '1d20', mode: 'normal', label: '' }],
    ]);
    expect(resends).toEqual([]);
  });

  it("refuses a player's message that is no valid player message", () => {
    const { sockets } = dm();
    sockets[0]!.open();
    expect(() => sockets[0]!.receive('thorin\nnull')).toThrow();
    expect(() => sockets[0]!.receive(`thorin\n${message('player', { type: 'rolled', text: 'x' })}`)).toThrow();
  });

  it('reports player counts from status frames', () => {
    const { transport, sockets } = dm();
    const counts: number[] = [];
    transport.watchStatus(({ players }) => counts.push(players));
    sockets[0]!.open();
    sockets[0]!.receive(status({ party: 2, thorin: 1 }));
    expect(counts).toEqual([0, 3]);
  });
});
