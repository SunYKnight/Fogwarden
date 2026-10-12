import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  RELAY_API_VERSION,
  RELAY_DM_PROTOCOL,
  RELAY_HASH_HEADER,
  RELAY_LINK_REVOKED,
  RELAY_MAX_UPLOAD_BYTES,
  relaySessionSchema,
  type RelaySession,
  type RelayStatus,
} from '@/sync/relayApi';
import { createRelay, type Relay } from './relayServer';

const DM_KEY = 'a'.repeat(64);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const TOKEN_A = 'linkA_0123456789abcdef';
const TOKEN_B = 'linkB_0123456789abcdef';
const HELLO = '{"protocol":2,"from":"player","payload":{"type":"hello"}}';

let dataDir: string;
let relay: Relay;
let base: string;

async function start(): Promise<void> {
  relay = await createRelay({ dmKey: DM_KEY, dataDir });
  const { promise, resolve } = Promise.withResolvers<void>();
  relay.server.listen(0, '127.0.0.1', resolve);
  await promise;
  base = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  await start();
});

afterEach(async () => {
  await relay.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function put(target: string, body: Buffer, key = DM_KEY, hash = sha256(body)): Promise<Response> {
  return fetch(`${base}${target}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, [RELAY_HASH_HEADER]: hash },
    body: new Uint8Array(body),
  });
}

function putLinks(links: Record<string, string>, key = DM_KEY): Promise<Response> {
  return fetch(`${base}/api/links`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ links }),
  });
}

async function session(): Promise<RelaySession> {
  const response = await fetch(`${base}/api/session`, { headers: { authorization: `Bearer ${DM_KEY}` } });
  return relaySessionSchema.parse(await response.json());
}

const statusIs = (relayStatus: RelayStatus['relay']) => (text: string) =>
  text.startsWith('{') && isDeepStrictEqual(JSON.parse(text), { relay: relayStatus });

/** Opens a socket; `message(check)` resolves with the first text message, past or future, passing `check`. */
function connect(url: string, protocols?: string[]) {
  const socket = new WebSocket(url.replace('http', 'ws'), protocols);
  const messages: string[] = [];
  const waiters: { check: (text: string) => boolean; resolve: (text: string) => void }[] = [];
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<number>();
  socket.on('open', () => opened.resolve());
  socket.on('message', (data) => {
    const text = data.toString();
    messages.push(text);
    for (const waiter of waiters.filter((w) => w.check(text))) {
      waiter.resolve(text);
    }
  });
  socket.on('close', (code) => closed.resolve(code));
  socket.on('unexpected-response', (_request, response) => opened.reject(new Error(`HTTP ${response.statusCode}`)));
  socket.on('error', (error) => opened.reject(error));
  const message = (check: (text: string) => boolean) => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const seen = messages.find(check);
    if (seen === undefined) {
      waiters.push({ check, resolve });
    } else {
      resolve(seen);
    }
    return promise;
  };
  return { socket, messages, message, opened: opened.promise, closed: closed.promise };
}

const player = (token: string) => connect(`${base}/ws?token=${token}`);

describe('relay sockets', () => {
  it('forwards DM frames only to the addressed views and tags hellos with the view', async () => {
    expect((await putLinks({ [TOKEN_A]: 'A', [TOKEN_B]: 'B' })).status).toBe(204);
    const dm = connect(`${base}/ws`, [RELAY_DM_PROTOCOL, DM_KEY]);
    await dm.opened;
    await dm.message(statusIs({ players: 0, views: {} }));
    const a = player(TOKEN_A);
    const b = player(TOKEN_B);
    await Promise.all([a.opened, b.opened]);
    await dm.message(statusIs({ players: 2, views: { A: 1, B: 1 } }));

    a.socket.send(HELLO);
    expect(await dm.message((m) => m.includes('hello'))).toBe(`A\n${HELLO}`);

    dm.socket.send('B\nfor B');
    dm.socket.send('A,B\nfor both');
    dm.socket.send('A\nfor A');
    dm.socket.send('B\nend');
    await Promise.all([a.message((m) => m === 'for A'), b.message((m) => m === 'end')]);
    expect(a.messages).toEqual(['for both', 'for A']);
    expect(b.messages).toEqual(['for B', 'for both', 'end']);

    a.socket.close();
    await dm.message(statusIs({ players: 1, views: { B: 1 } }));
  });

  it('closes a DM socket whose frame lacks a view list', async () => {
    const dm = connect(`${base}/ws`, [RELAY_DM_PROTOCOL, DM_KEY]);
    await dm.opened;
    dm.socket.send('{"protocol":2,"from":"dm","payload":{"type":"map","revision":1,"map":null}}');
    expect(await dm.closed).toBe(1008);
  });

  it('closes a player socket that sends an invalid message', async () => {
    await putLinks({ [TOKEN_A]: 'A' });
    const extra = player(TOKEN_A);
    await extra.opened;
    extra.socket.send('{"protocol":2,"from":"player","payload":{"type":"hello","map":null}}');
    expect(await extra.closed).toBe(1008);

    const dmMessage = player(TOKEN_A);
    await dmMessage.opened;
    dmMessage.socket.send('{"protocol":2,"from":"dm","payload":{"type":"map","revision":1,"map":null}}');
    expect(await dmMessage.closed).toBe(1008);

    const garbage = player(TOKEN_A);
    await garbage.opened;
    garbage.socket.send('not json');
    expect(await garbage.closed).toBe(1008);
  });

  it("forwards players' rolls, pings and own token moves rebuilt and tagged with the view", async () => {
    await putLinks({ [TOKEN_A]: 'A', [TOKEN_B]: 'party' });
    const dm = connect(`${base}/ws`, [RELAY_DM_PROTOCOL, DM_KEY]);
    await dm.opened;
    const a = player(TOKEN_A);
    const party = player(TOKEN_B);
    await Promise.all([a.opened, party.opened]);
    const roll =
      '{"protocol":2,"from":"player","payload":{"type":"roll","dice":"1d20+5","mode":"normal","label":"Hit"}}';
    a.socket.send(` ${roll.replace('"mode"', ' "mode"')} `);
    const point = '{"protocol":2,"from":"player","payload":{"type":"point","at":{"x":1.5,"y":2,"elevationFt":0}}}';
    party.socket.send(point);
    const move =
      '{"protocol":2,"from":"player","payload":{"type":"move","combatantId":"A","to":{"x":5,"y":5,"elevationFt":0}}}';
    a.socket.send(move);
    expect(await dm.message((m) => m.includes('"roll"'))).toBe(`A\n${roll}`);
    expect(await dm.message((m) => m.includes('"point"'))).toBe(`party\n${point}`);
    expect(await dm.message((m) => m.includes('"move"'))).toBe(`A\n${move}`);
  });

  it("closes a player socket whose request is malformed or for another view's token", async () => {
    await putLinks({ [TOKEN_A]: 'A', [TOKEN_B]: 'party' });
    const sends = async (token: string, payload: string) => {
      const socket = player(token);
      await socket.opened;
      socket.socket.send(`{"protocol":2,"from":"player","payload":${payload}}`);
      return socket.closed;
    };
    const to = '"to":{"x":5,"y":5,"elevationFt":0}';
    expect(await sends(TOKEN_A, `{"type":"move","combatantId":"B",${to}}`)).toBe(1008);
    expect(await sends(TOKEN_B, `{"type":"move","combatantId":"party",${to}}`)).toBe(1008);
    expect(await sends(TOKEN_B, '{"type":"roll","dice":"1d20","mode":"normal","label":""}')).toBe(1008);
    expect(await sends(TOKEN_A, '{"type":"roll","dice":"1d20;rm","mode":"normal","label":""}')).toBe(1008);
    expect(await sends(TOKEN_A, '{"type":"point","at":{"x":"1","y":2,"elevationFt":0}}')).toBe(1008);
    expect(await sends(TOKEN_A, '{"type":"point","at":{"x":1,"y":2,"elevationFt":0},"by":"DM"}')).toBe(1008);
    expect(await sends(TOKEN_A, '{"type":"point","at":{"x":1e9,"y":2,"elevationFt":0}}')).toBe(1008);
  });

  it('drops player messages beyond the rate limit', async () => {
    // A frozen clock keeps the bucket from refilling during the burst.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await putLinks({ [TOKEN_A]: 'A' });
      const dm = connect(`${base}/ws`, [RELAY_DM_PROTOCOL, DM_KEY]);
      await dm.opened;
      const a = player(TOKEN_A);
      await a.opened;
      const point = (x: number) =>
        `{"protocol":2,"from":"player","payload":{"type":"point","at":{"x":${x},"y":0,"elevationFt":0}}}`;
      for (let x = 0; x < 14; x++) {
        a.socket.send(point(x));
      }
      await dm.message((m) => m.includes('"x":9,'));
      vi.setSystemTime(Date.now() + 600);
      a.socket.send(HELLO);
      await dm.message((m) => m.includes('hello'));
      const xs = dm.messages.filter((m) => m.includes('"point"')).map((m) => Number(/"x":(\d+)/.exec(m)![1]));
      expect(xs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(a.socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a wrong DM key and a wrong player token', async () => {
    await expect(connect(`${base}/ws`, [RELAY_DM_PROTOCOL, 'b'.repeat(64)]).opened).rejects.toThrow('HTTP 401');
    await expect(player('wrong').opened).rejects.toThrow('HTTP 401');
    const response = await fetch(`${base}/api/session`, { headers: { authorization: 'Bearer wrong' } });
    expect(response.status).toBe(401);
  });

  it('reports the API version and player count in the session', async () => {
    expect(await session()).toEqual({ api: RELAY_API_VERSION, players: 0 });
  });
});

describe('relay links', () => {
  const asset = '/asset/data/library/maps/m1/assets/map.png';

  beforeEach(async () => {
    await put(`/api${asset}`, PNG);
    await put('/api/bundle/player.html', Buffer.from('<html></html>'));
  });

  it('closes the socket of a withdrawn link and refuses its token afterwards', async () => {
    await putLinks({ [TOKEN_A]: 'A' });
    expect((await fetch(`${base}/?t=${TOKEN_A}`)).status).toBe(200);
    const a = player(TOKEN_A);
    await a.opened;

    expect((await putLinks({ [TOKEN_B]: 'A' })).status).toBe(204);
    expect(await a.closed).toBe(RELAY_LINK_REVOKED);
    await expect(player(TOKEN_A).opened).rejects.toThrow('HTTP 401');
    expect((await fetch(`${base}/?t=${TOKEN_A}`)).status).toBe(401);
    expect((await fetch(`${base}${asset}?token=${TOKEN_A}`)).status).toBe(401);
    expect((await fetch(`${base}${asset}`, { headers: { cookie: `fogwarden-relay=${TOKEN_A}` } })).status).toBe(401);
  });

  it('moves a socket whose link changes view to a reconnect into the new view', async () => {
    await putLinks({ [TOKEN_A]: 'A' });
    const dm = connect(`${base}/ws`, [RELAY_DM_PROTOCOL, DM_KEY]);
    await dm.opened;
    const a = player(TOKEN_A);
    await a.opened;
    await dm.message(statusIs({ players: 1, views: { A: 1 } }));

    await putLinks({ [TOKEN_A]: 'B' });
    expect(await a.closed).toBe(1013);
    const again = player(TOKEN_A);
    await again.opened;
    await dm.message(statusIs({ players: 1, views: { B: 1 } }));
    dm.socket.send('A\nold view');
    dm.socket.send('B\nnew view');
    await again.message((m) => m === 'new view');
    expect(again.messages).toEqual(['new view']);
  });

  it('accepts only tokens of the map, not a view name or an altered token', async () => {
    await putLinks({ [TOKEN_A]: 'party' });
    const altered = `${TOKEN_A.slice(0, -1)}0`;
    for (const token of ['party', altered]) {
      await expect(player(token).opened).rejects.toThrow('HTTP 401');
      expect((await fetch(`${base}/?t=${token}`)).status).toBe(401);
      expect((await fetch(`${base}${asset}?token=${token}`)).status).toBe(401);
    }
  });

  it('keeps the links across a relay restart', async () => {
    await putLinks({ [TOKEN_A]: 'A' });
    await relay.close();
    await start();
    const a = player(TOKEN_A);
    await a.opened;
    a.socket.close();
  });

  it('rejects links from anyone but the DM and malformed links', async () => {
    expect((await putLinks({ [TOKEN_A]: 'A' }, 'b'.repeat(64))).status).toBe(401);
    expect((await putLinks({ short: 'A' })).status).toBe(400);
    expect((await putLinks({ [TOKEN_A]: 'a,b' })).status).toBe(400);
    await expect(player(TOKEN_A).opened).rejects.toThrow('HTTP 401');
  });
});

describe('relay uploads', () => {
  const target = '/api/asset/data/library/maps/m1/assets/map.png';

  it('stores an asset for the DM only and reports it current afterwards', async () => {
    expect((await put(target, PNG, 'b'.repeat(64))).status).toBe(401);
    const ask = () =>
      fetch(`${base}/api/missing`, {
        method: 'POST',
        headers: { authorization: `Bearer ${DM_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ files: [{ target, sha256: sha256(PNG) }] }),
      }).then((r) => r.json());
    expect(await ask()).toEqual({ missing: [target] });
    expect((await put(target, PNG)).status).toBe(204);
    expect(await ask()).toEqual({ missing: [] });
  });

  it('rejects paths outside the area, other file types, wrong hashes and oversized bodies', async () => {
    expect((await put('/api/asset/data/a%2F..%2F..%2Fx.png', PNG)).status).toBe(400);
    expect((await put('/api/asset/data/..%5C..%5Cx.png', PNG)).status).toBe(400);
    expect((await put('/api/asset/secrets/x.png', PNG)).status).toBe(404);
    expect((await put('/api/asset/data/library/maps/m1/map.json', PNG)).status).toBe(403);
    expect((await put(target, PNG, DM_KEY, sha256(Buffer.from('other')))).status).toBe(400);

    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const oversized = httpRequest(`${base}${target}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${DM_KEY}`,
        [RELAY_HASH_HEADER]: sha256(PNG),
        'content-length': RELAY_MAX_UPLOAD_BYTES + 1,
      },
    });
    oversized.on('response', (response) => resolve(response.statusCode ?? 0));
    oversized.on('error', reject);
    oversized.write(PNG);
    expect(await promise).toBe(413);
    oversized.destroy();
  });

  it('takes pictures from shipped and imported packs but never their documents', async () => {
    expect((await put('/api/asset/content/packs/srd/creatures/srd-goblin.png', PNG)).status).toBe(204);
    expect((await put('/api/asset/data/packs/mm/maps/m1/assets/map.png', PNG)).status).toBe(204);
    expect((await put('/api/asset/data/packs/mm/pack.json', PNG)).status).toBe(403);
    expect((await put('/api/asset/data/packs/mm/creatures/goblin.txt', PNG)).status).toBe(403);
    expect((await put('/api/asset/data/packs%2F..%2F..%2Fx.png', PNG)).status).toBe(400);
  });
});

describe('relay player access', () => {
  const asset = '/asset/data/library/maps/m1/assets/map.png';

  it('serves assets with the token in the query or the cookie only', async () => {
    await put(`/api${asset}`, PNG);
    await putLinks({ [TOKEN_A]: 'A' });
    expect((await fetch(`${base}${asset}`)).status).toBe(401);
    expect((await fetch(`${base}${asset}?token=wrong`)).status).toBe(401);
    const byQuery = await fetch(`${base}${asset}?token=${TOKEN_A}`);
    expect(byQuery.status).toBe(200);
    expect(byQuery.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await byQuery.arrayBuffer())).toEqual(PNG);
    const byCookie = await fetch(`${base}${asset}`, { headers: { cookie: `fogwarden-relay=${TOKEN_A}` } });
    expect(byCookie.status).toBe(200);
    expect((await fetch(`${base}/asset/data/settings.json?token=${TOKEN_A}`)).status).toBe(403);
  });

  it('serves audio and video in byte ranges so every browser can play and seek them', async () => {
    const track = '/asset/data/library/sounds/tavern.ogg';
    const bytes = Buffer.from('0123456789');
    expect((await put(`/api${track}`, bytes)).status).toBe(204);
    await putLinks({ [TOKEN_A]: 'A' });
    const url = `${base}${track}?token=${TOKEN_A}`;
    const whole = await fetch(url);
    expect(whole.headers.get('content-type')).toBe('audio/ogg');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    const part = await fetch(url, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    const tail = await fetch(url, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    expect((await fetch(url, { headers: { range: 'bytes=20-' } })).status).toBe(416);
  });

  it('serves the uploaded player page for a link token and its chunks publicly', async () => {
    await putLinks({ [TOKEN_A]: 'A', [TOKEN_B]: 'B' });
    expect((await fetch(`${base}/?t=${TOKEN_A}`)).status).toBe(503);
    const chunk = Buffer.from('console.log(1)');
    expect((await put('/api/bundle/assets/player-abc.js', chunk)).status).toBe(204);
    expect((await put('/api/bundle/player.html', Buffer.from('<html></html>'))).status).toBe(204);

    expect((await fetch(`${base}/?t=wrong`)).status).toBe(401);
    const page = await fetch(`${base}/?t=${TOKEN_B}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('<html></html>');
    expect(page.headers.get('set-cookie')).toContain(`fogwarden-relay=${TOKEN_B}; Path=/asset; HttpOnly`);
    const script = await fetch(`${base}/assets/player-abc.js`);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(await script.text()).toBe('console.log(1)');
  });

  it('answers the health check without credentials to any origin', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toMatchObject({ ok: true });
  });
});
