import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { PARTY_VIEW } from '@/core/model';
import { rebuildPlayerMessage } from '@/sync/protocol';
import {
  fileExtension,
  isPlayerUploadName,
  parseViewFrame,
  PLAYER_UPLOAD_MAX_PENDING,
  PLAYER_UPLOAD_TYPES,
  playerUploadSchema,
  RELAY_API_VERSION,
  RELAY_ASSET_TYPES,
  RELAY_BUNDLE_TYPES,
  RELAY_DM_PROTOCOL,
  RELAY_HASH_HEADER,
  RELAY_LINK_PARAM,
  RELAY_LINK_REVOKED,
  RELAY_PLAYER_PAGE,
  RELAY_TOKEN_COOKIE,
  relayLinksSchema,
  relayMissingRequestSchema,
  type PlayerUpload,
  type RelaySession,
  type RelayStatus,
  type RelayUploads,
  viewFrame,
} from '@/sync/relayApi';
import { containedPath, FileStore, HttpError } from './store';

const RELAY_SERVICE = 'fogwarden-relay';
/** Player messages are a hello, a roll, a ping or a move; anything bigger is not a valid message. */
const PLAYER_MESSAGE_LIMIT = 1024;
/** A player may send this many messages at once, then one per `PLAYER_REFILL_MS`; more are dropped. */
const PLAYER_BURST = 10;
const PLAYER_REFILL_MS = 500;
/** Full map messages carry base64 terrain heights and can reach several MB. */
const DM_MESSAGE_LIMIT = 64 * 1024 * 1024;
/** A player this far behind is dropped and reconnects for a fresh resend. */
const PLAYER_BACKLOG_LIMIT = 16 * 1024 * 1024;
const JSON_BODY_LIMIT = 1024 * 1024;
/** Below nginx's default 60 s proxy timeout, so idle sockets stay open. */
const HEARTBEAT_MS = 30_000;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const AREAS: Record<string, true> = { data: true, content: true };
const CLOSE_POLICY = 1008;
const CLOSE_UNSUPPORTED = 1003;
const CLOSE_AGAIN = 1013;
const LINKS_FILE = 'links.json';
/** `<view>/<id>` holds a player's picture, `<view>/<id>.json` its `PlayerUpload` record. */
const UPLOADS_DIR = 'player-uploads';

/**
 * The single range of a `Range: bytes=…` header (Safari needs ranges to play audio and video); null without
 * one or for several ranges, which get the whole file.
 */
export function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  const [, from = '', to = ''] = match ?? [];
  const suffix = from === '' && to !== '';
  const start = suffix ? Math.max(0, size - Number(to)) : Number(from);
  const end = suffix || to === '' ? size - 1 : Math.min(size - 1, Number(to));
  const satisfiable = start <= end && start < size;
  return !match || (from === '' && to === '') ? null : satisfiable ? { start, end } : 'unsatisfiable';
}

export interface RelayOptions {
  /** Shared secret of the DM app, created by the install script. */
  dmKey: string;
  /** Uploaded assets, player bundle and the player links live here. */
  dataDir: string;
}

export interface Relay {
  server: Server;
  close(): Promise<void>;
}

interface Request {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  /** Decoded path segments after the route's own segments. */
  rest: string[];
}

type Handler = (request: Request) => Promise<void>;

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

// Comparing digests keeps the time constant and independent of the length.
function secretMatches(expected: string, given: string): boolean {
  return timingSafeEqual(digest(expected), digest(given));
}

function cookie(request: IncomingMessage, name: string): string {
  const pairs = (request.headers.cookie ?? '').split(';').map((pair) => pair.trim().split('='));
  return pairs.find(([key]) => key === name)?.[1] ?? '';
}

function send(response: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > JSON_BODY_LIMIT) {
      throw new HttpError(413, 'request body too large');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function contentType(types: Record<string, string>, path: string): string {
  const type = types[fileExtension(path)];
  if (!type) {
    throw new HttpError(403, `file type not allowed: ${path}`);
  }
  return type;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, `malformed path segment: ${segment}`);
  }
}

/**
 * HTTP + WebSocket relay between one DM app and the players' browsers, mirroring the LAN server
 * (`src-tauri/src/lan.rs`): the DM publishes over `/ws`, players receive and may only send the messages
 * `rebuildPlayerMessage` accepts for their view, at a limited rate. The DM
 * uploads assets and the player bundle; the relay never sees anything the DM's player filter removed. Each
 * player link token shows one view; the DM addresses every frame to views and the relay forwards it only to
 * players of those views. The links live in `dataDir/links.json`, so players get in while the DM is away.
 * Character views the DM allows may upload pictures; they wait in `dataDir/player-uploads/` for the DM app,
 * which alone fetches and deletes them, so no player ever sees another player's upload through the relay.
 */
export async function createRelay({ dmKey, dataDir }: RelayOptions): Promise<Relay> {
  if (dmKey.length < 32) {
    throw new Error('The DM key must have at least 32 characters');
  }
  const store = new FileStore(dataDir);
  const saved = await store.readText(LINKS_FILE);
  const savedLinks = relayLinksSchema.parse(saved === null ? { links: {} } : JSON.parse(saved));
  let links = new Map(Object.entries(savedLinks.links));
  let uploadViews = new Set(savedLinks.uploads);
  const uploads = await loadUploads(store);
  // Uploads of a view still streaming in, counted against its limit.
  const receiving = new Map<string, number>();
  const uploadRates = new Map<string, () => boolean>();
  const dmSockets = new WebSocketServer({
    noServer: true,
    maxPayload: DM_MESSAGE_LIMIT,
    handleProtocols: () => RELAY_DM_PROTOCOL,
  });
  const playerSockets = new WebSocketServer({ noServer: true, maxPayload: PLAYER_MESSAGE_LIMIT });
  const alive = new WeakSet<WebSocket>();
  const players = new Map<WebSocket, { token: string; view: string }>();

  const requireDm = (request: IncomingMessage) => {
    const given = (request.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!secretMatches(dmKey, given)) {
      throw new HttpError(401, 'missing or wrong DM key');
    }
  };

  const requirePlayer = (given: string) => {
    if (!links.has(given)) {
      throw new HttpError(401, 'missing or withdrawn player link');
    }
  };

  const tellDms = (notice: RelayStatus | RelayUploads | string) => {
    const text = typeof notice === 'string' ? notice : JSON.stringify(notice);
    for (const dm of dmSockets.clients) {
      dm.send(text);
    }
  };

  const uploadsFrame = (): RelayUploads => ({ uploads: [...uploads.values()].sort((a, b) => a.at - b.at) });

  const status = (): RelayStatus => {
    const views = new Map<string, number>();
    for (const { view } of players.values()) {
      views.set(view, (views.get(view) ?? 0) + 1);
    }
    // fromEntries defines own keys, so a view named __proto__ stays a key.
    return { relay: { players: players.size, views: Object.fromEntries(views) } };
  };

  const replaceLinks = (next: Map<string, string>, nextUploads: Set<string>) => {
    links = next;
    uploadViews = nextUploads;
    for (const token of uploadRates.keys()) {
      if (!links.has(token)) {
        uploadRates.delete(token);
      }
    }
    for (const [socket, { token, view }] of players) {
      const current = links.get(token);
      if (current !== view) {
        // Dropped here already, so no frame of the old view reaches it while
        // the close handshake runs.
        players.delete(socket);
        if (current === undefined) {
          socket.close(RELAY_LINK_REVOKED, 'link revoked');
        } else {
          socket.close(CLOSE_AGAIN, 'view changed, reconnect');
        }
      }
    }
    tellDms(status());
  };

  const serveFile = async ({ request, response }: Request, file: string, headers: Record<string, string>) => {
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
      throw error.code === 'ENOENT' ? new HttpError(404, 'not found') : error;
    });
    const etag = `"${await store.sha256(file)}"`;
    const range = byteRange(request.headers.range, info.size);
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ...headers, etag });
      response.end();
    } else if (range === 'unsatisfiable') {
      response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` });
      response.end();
    } else if (range) {
      response.writeHead(206, {
        ...headers,
        etag,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
        'content-length': range.end - range.start + 1,
      });
      await pipeline(createReadStream(file, range), response);
    } else {
      response.writeHead(200, { ...headers, etag, 'accept-ranges': 'bytes', 'content-length': info.size });
      await pipeline(createReadStream(file), response);
    }
  };

  // Upload target → file: `asset/{area}/{path}` or `bundle/{path}` below the data folder.
  const uploadFile = (segments: string[]) => {
    const [kind, ...rest] = segments;
    const area = rest[0] ?? '';
    const isAsset = kind === 'asset' && AREAS[area] === true;
    if (!isAsset && kind !== 'bundle') {
      throw new HttpError(404, `unknown upload target: ${segments.join('/')}`);
    }
    const path = (isAsset ? rest.slice(1) : rest).join('/');
    contentType(isAsset ? RELAY_ASSET_TYPES : RELAY_BUNDLE_TYPES, path);
    return isAsset ? containedPath(store.file('assets', area), path) : containedPath(store.file('bundle'), path);
  };

  const playerPage: Handler = async ({ request, response, url }) => {
    const token = url.searchParams.get(RELAY_LINK_PARAM) ?? url.searchParams.get('token') ?? '';
    requirePlayer(token);
    const page = await readFile(store.file('bundle', RELAY_PLAYER_PAGE), 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        throw error.code === 'ENOENT' ? new HttpError(503, 'The DM has not connected to this server yet.') : error;
      },
    );
    const secure = (request.headers['x-forwarded-proto'] ?? '').toString().startsWith('https') ? '; Secure' : '';
    response.writeHead(200, {
      'content-type': contentType(RELAY_BUNDLE_TYPES, RELAY_PLAYER_PAGE),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'set-cookie': `${RELAY_TOKEN_COOKIE}=${token}; Path=/asset; HttpOnly; SameSite=Strict${secure}`,
    });
    response.end(page);
  };

  // Vite's chunk names carry a content hash and hold app code, no user data.
  const bundleFile: Handler = (req) => {
    const path = req.rest.join('/');
    const type = contentType(RELAY_BUNDLE_TYPES, path);
    const file = containedPath(store.file('bundle', 'assets'), path);
    return serveFile(req, file, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' });
  };

  const asset: Handler = (req) => {
    const [area = '', ...rest] = req.rest;
    requirePlayer(req.url.searchParams.get('token') ?? cookie(req.request, RELAY_TOKEN_COOKIE));
    if (AREAS[area] !== true) {
      throw new HttpError(404, `unknown area: ${area}`);
    }
    const path = rest.join('/');
    const type = contentType(RELAY_ASSET_TYPES, path);
    // CORS: three.js loaders request in CORS mode, and a player page from
    // the Vite dev server loads assets cross-origin.
    return serveFile(req, containedPath(store.file('assets', area), path), {
      'content-type': type,
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
  };

  const session: Handler = async ({ request, response }) => {
    requireDm(request);
    const body: RelaySession = { api: RELAY_API_VERSION, players: players.size };
    send(response, 200, JSON.stringify(body), 'application/json');
  };

  const putLinks: Handler = async ({ request, response }) => {
    requireDm(request);
    const body = relayLinksSchema.parse(await readJson(request));
    await store.writeText(LINKS_FILE, JSON.stringify(body));
    response.writeHead(204);
    response.end();
    replaceLinks(new Map(Object.entries(body.links)), new Set(body.uploads));
  };

  const missing: Handler = async ({ request, response }) => {
    requireDm(request);
    const { files } = relayMissingRequestSchema.parse(await readJson(request));
    const current = await Promise.all(
      files.map(async ({ target, sha256 }) => {
        if (!target.startsWith('/api/')) {
          throw new HttpError(400, `not an upload target: ${target}`);
        }
        const file = uploadFile(target.split('/').slice(2).map(decodeSegment));
        return (await store.sha256(file)) === sha256;
      }),
    );
    const body = { missing: files.filter((_, i) => !current[i]).map((f) => f.target) };
    send(response, 200, JSON.stringify(body), 'application/json');
  };

  const upload =
    (kind: 'asset' | 'bundle'): Handler =>
    async ({ request, response, rest }) => {
      requireDm(request);
      const sha256 = String(request.headers[RELAY_HASH_HEADER] ?? '');
      if (!SHA256_HEX.test(sha256)) {
        throw new HttpError(400, `${RELAY_HASH_HEADER} header with a lowercase hex SHA-256 required`);
      }
      await store.receive(request, uploadFile([kind, ...rest]), sha256);
      response.writeHead(204);
      response.end();
    };

  const pictureFile = (upload: PlayerUpload) => store.file(UPLOADS_DIR, upload.view, upload.id);

  // One picture per request, streamed to disk; only its first bytes are
  // read here, the DM app checks the picture itself.
  const playerUpload: Handler = async ({ request, response, url, rest }) => {
    const token = url.searchParams.get('token') ?? '';
    requirePlayer(token);
    const view = links.get(token)!;
    const [name = ''] = rest;
    const waiting = [...uploads.values()].filter((u) => u.view === view).length + (receiving.get(view) ?? 0);
    const allowed = uploadRates.get(token) ?? playerRateLimit();
    uploadRates.set(token, allowed);
    // Every attempt counts against the rate, refused ones too.
    const refusals: [boolean, number, string][] = [
      [!allowed(), 429, 'too many uploads, wait a moment'],
      [rest.length !== 1 || !isPlayerUploadName(name), 400, `invalid file name: ${rest.join('/')}`],
      [view === PARTY_VIEW, 403, 'the party view cannot upload'],
      [!uploadViews.has(view), 403, 'the DM does not take pictures from players'],
      [waiting >= PLAYER_UPLOAD_MAX_PENDING, 429, `${PLAYER_UPLOAD_MAX_PENDING} pictures already wait for the DM`],
    ];
    const refused = refusals.find(([refuse]) => refuse);
    if (refused) {
      throw new HttpError(refused[1], refused[2]);
    }
    const id = randomBytes(16).toString('hex');
    receiving.set(view, (receiving.get(view) ?? 0) + 1);
    try {
      const { type, size } = await store.receivePicture(request, store.file(UPLOADS_DIR, view, id));
      const upload: PlayerUpload = { id, view, name, type, size, at: Date.now() };
      await store.writeText(join(UPLOADS_DIR, view, `${id}.json`), JSON.stringify(upload));
      uploads.set(id, upload);
    } finally {
      receiving.set(view, receiving.get(view)! - 1);
    }
    tellDms(uploadsFrame());
    send(response, 201, JSON.stringify({ id }), 'application/json');
  };

  const uploadOf = (rest: string[]) => (rest.length === 1 ? uploads.get(rest[0]!) : undefined);

  const fetchUpload: Handler = (req) => {
    requireDm(req.request);
    const upload = uploadOf(req.rest);
    if (!upload) {
      throw new HttpError(404, 'no such upload');
    }
    return serveFile(req, pictureFile(upload), {
      'content-type': PLAYER_UPLOAD_TYPES[upload.type],
      'cache-control': 'no-store',
    });
  };

  // Repeating a delete whose answer got lost is no error.
  const deleteUpload: Handler = async ({ request, response, rest }) => {
    requireDm(request);
    const upload = uploadOf(rest);
    if (upload) {
      uploads.delete(upload.id);
      // The record goes first: a picture without one is removed on start.
      await rm(store.file(UPLOADS_DIR, upload.view, `${upload.id}.json`), { force: true });
      await rm(pictureFile(upload), { force: true });
      tellDms(uploadsFrame());
    }
    response.writeHead(204);
    response.end();
  };

  // The DM app's connection test calls this cross-origin from its webview.
  const health: Handler = async ({ response }) => {
    response.setHeader('access-control-allow-origin', '*');
    send(response, 200, JSON.stringify({ ok: true, service: RELAY_SERVICE }), 'application/json');
  };

  /** Key: method plus the route's leading segments; the remaining segments become `rest`. */
  const routes: Record<string, { segments: number; handler: Handler }> = {
    'GET /health': { segments: 1, handler: health },
    'GET /': { segments: 1, handler: playerPage },
    'GET /player.html': { segments: 1, handler: playerPage },
    'GET /assets': { segments: 1, handler: bundleFile },
    'GET /asset': { segments: 1, handler: asset },
    'GET /api/session': { segments: 2, handler: session },
    'PUT /api/links': { segments: 2, handler: putLinks },
    'POST /api/missing': { segments: 2, handler: missing },
    'PUT /api/asset': { segments: 2, handler: upload('asset') },
    'PUT /api/bundle': { segments: 2, handler: upload('bundle') },
    'PUT /api/player-upload': { segments: 2, handler: playerUpload },
    'GET /api/player-upload': { segments: 2, handler: fetchUpload },
    'DELETE /api/player-upload': { segments: 2, handler: deleteUpload },
  };

  const dispatch = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://relay');
    const segments = url.pathname.split('/').slice(1);
    const api = segments[0] === 'api';
    const method = request.method === 'HEAD' ? 'GET' : (request.method ?? '');
    const key = `${method} /${api ? `api/${segments[1] ?? ''}` : (segments[0] ?? '')}`;
    const route = routes[key];
    if (api) {
      // The DM app's webview calls from its own origin with a bearer key,
      // never with cookies, so any origin may ask.
      response.setHeader('access-control-allow-origin', '*');
    }
    if (api && method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PUT, DELETE',
        'access-control-allow-headers': `authorization, content-type, ${RELAY_HASH_HEADER}`,
        'access-control-max-age': '600',
      });
      response.end();
    } else if (route) {
      const rest = segments.slice(route.segments).map(decodeSegment);
      await route.handler({ request, response, url, rest });
    } else {
      throw new HttpError(404, 'not found');
    }
  };

  const server = createServer((request, response) => {
    dispatch(request, response).catch((error: unknown) => {
      const known = error instanceof HttpError;
      const invalid = error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError');
      if (!known && !invalid) {
        console.error(`${request.method} ${request.url?.split('?')[0]} failed:`, error);
      }
      const status = known ? error.status : invalid ? 400 : 500;
      if (response.headersSent) {
        response.destroy();
      } else {
        // A rejected upload may still be streaming; closing the connection
        // stops the client instead of reading the rest of the body.
        response.setHeader('connection', 'close');
        send(response, status, known || invalid ? error.message : 'internal error');
      }
    });
  });

  const watch = (socket: WebSocket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    // Without a listener, a protocol error (oversized frame, bad UTF-8)
    // throws and ends the process; ws closes the socket itself.
    socket.on('error', (error) => console.error('WebSocket error:', error.message));
  };

  dmSockets.on('connection', (socket) => {
    watch(socket);
    socket.send(JSON.stringify(status()));
    socket.send(JSON.stringify(uploadsFrame()));
    socket.on('message', (data: RawData, isBinary: boolean) => {
      // Only the view list is decoded; the message, up to several MB, goes
      // out as the very bytes received.
      const frame = data as Buffer;
      const end = frame.indexOf('\n');
      const parsed = parseViewFrame(frame.subarray(0, end + 1).toString());
      if (isBinary) {
        socket.close(CLOSE_UNSUPPORTED, 'text messages only');
      } else if (parsed === null) {
        socket.close(CLOSE_POLICY, 'frames must start with a view list');
      } else {
        const audience = new Set(parsed.views);
        const message = frame.subarray(end + 1);
        for (const [player, { view }] of players) {
          if (audience.has(view) && player.bufferedAmount > PLAYER_BACKLOG_LIMIT) {
            player.close(CLOSE_AGAIN, 'fell behind, reconnect');
          } else if (audience.has(view)) {
            player.send(message, { binary: false });
          }
        }
      }
    });
  });

  playerSockets.on('connection', (socket: WebSocket) => {
    watch(socket);
    tellDms(status());
    socket.on('close', () => {
      players.delete(socket);
      tellDms(status());
    });
    const allowed = playerRateLimit();
    socket.on('message', (data: RawData, isBinary: boolean) => {
      // Read per message: a withdrawn or moved socket leaves `players` at
      // once but still receives messages until its close handshake ends.
      const view = players.get(socket)?.view;
      if (view !== undefined) {
        const message = isBinary ? null : rebuildPlayerMessage(data.toString(), view);
        if (message === null) {
          socket.close(CLOSE_POLICY, 'not a valid player message');
        } else if (allowed()) {
          tellDms(viewFrame([view], message));
        }
      }
    });
  });

  const reject = (socket: Duplex, status: number, reason: string) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://relay');
    const protocols = (request.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
    const asDm = protocols[0] === RELAY_DM_PROTOCOL;
    const token = url.searchParams.get('token') ?? '';
    const view = links.get(token);
    if (url.pathname !== '/ws') {
      reject(socket, 404, 'Not Found');
    } else if (asDm && secretMatches(dmKey, protocols[1] ?? '')) {
      dmSockets.handleUpgrade(request, socket, head, (ws) => dmSockets.emit('connection', ws, request));
    } else if (!asDm && view !== undefined) {
      playerSockets.handleUpgrade(request, socket, head, (ws) => {
        // Registered before 'connection', so its status frame counts it.
        players.set(ws, { token, view });
        playerSockets.emit('connection', ws);
      });
    } else {
      reject(socket, 401, 'Unauthorized');
    }
  });

  // Half-open connections (a player's phone going to sleep) never send a
  // close; unanswered pings find them.
  const heartbeat = setInterval(() => {
    for (const socket of [...dmSockets.clients, ...playerSockets.clients]) {
      if (alive.has(socket)) {
        alive.delete(socket);
        socket.ping();
      } else {
        socket.terminate();
      }
    }
  }, HEARTBEAT_MS);

  const close = async () => {
    clearInterval(heartbeat);
    for (const socket of [...dmSockets.clients, ...playerSockets.clients]) {
      socket.terminate();
    }
    const { promise, resolve, reject: fail } = Promise.withResolvers<void>();
    server.close((error) => (error ? fail(error) : resolve()));
    server.closeAllConnections();
    await promise;
  };

  return { server, close };
}

/**
 * The waiting player uploads, from their records in `player-uploads/<view>/`. A picture without a record is left
 * over from a crash between writing the two and goes.
 */
async function loadUploads(store: FileStore): Promise<Map<string, PlayerUpload>> {
  const found = new Map<string, PlayerUpload>();
  for (const view of await store.list(store.file(UPLOADS_DIR))) {
    const dir = store.file(UPLOADS_DIR, view);
    const names = await store.list(dir);
    const records = names.filter((name) => name.endsWith('.json'));
    for (const record of records) {
      const upload = playerUploadSchema.parse(JSON.parse(await readFile(join(dir, record), 'utf8')));
      found.set(upload.id, upload);
    }
    const orphans = names.filter((name) => !name.endsWith('.json') && !records.includes(`${name}.json`));
    await Promise.all(orphans.map((name) => rm(join(dir, name), { force: true })));
  }
  return found;
}

/** Token bucket of one player socket or one link's uploads: true while the player stays within its rate. */
function playerRateLimit(): () => boolean {
  let tokens = PLAYER_BURST;
  let at = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(PLAYER_BURST, tokens + (now - at) / PLAYER_REFILL_MS);
    at = now;
    const allowed = tokens >= 1;
    tokens -= allowed ? 1 : 0;
    return allowed;
  };
}
