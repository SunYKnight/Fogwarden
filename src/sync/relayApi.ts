import { z } from 'zod';

/**
 * HTTP and WebSocket contract between the DM app and the internet relay (`server/`). Both sides import it, so
 * the routes, limits and allowed file types cannot drift apart.
 */

/** WebSocket subprotocol naming the DM; the DM key travels as a second subprotocol, never in a logged URL. */
export const RELAY_DM_PROTOCOL = 'dmtool-dm';
/** Upload limit per file; the generated nginx site allows the same body size. */
export const RELAY_MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
/** Lowercase hex SHA-256 of the request body, required on every upload. */
export const RELAY_HASH_HEADER = 'x-content-sha256';
/** Cookie scoped to `/asset` so glTF side files, requested without the query, still carry the token. */
export const RELAY_TOKEN_COOKIE = 'dmtool-relay';
/** Player page query parameter; short because players type the link. */
export const RELAY_LINK_PARAM = 't';

/** Map images, tokens and models: the same set the LAN server serves (`asset_mime` in `src-tauri/src/lan.rs`). */
export const RELAY_ASSET_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  ktx2: 'image/ktx2',
};

/** What a Vite build of the player page consists of. */
export const RELAY_BUNDLE_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  json: 'application/json',
};

/** Built player page; uploaded after its chunks, so it never names a chunk the relay lacks. */
export const RELAY_PLAYER_PAGE = 'player.html';
/** Written into `dist/` by `tools/vite-relay-plugin.ts`: what the DM app uploads for the player page. */
export const PLAYER_BUNDLE_MANIFEST = 'player-bundle.json';
export const playerBundleSchema = z.object({
  /** Paths below `dist/`, the player page last. */
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
});
export type PlayerBundle = z.infer<typeof playerBundleSchema>;

/**
 * Version of this contract. 2: per-view player links (`PUT /api/links`) and view-routed frames on the DM
 * socket. The app refuses relays that report another version.
 */
export const RELAY_API_VERSION = 2;

export const relaySessionSchema = z.object({
  /** Missing on relays before version 2, which answered with a single player token instead. */
  api: z.number().int().positive().default(1),
  players: z.number().int().nonnegative(),
});
export type RelaySession = z.infer<typeof relaySessionSchema>;

/** A player view: 'party' or the combatant id of a player character. */
export const RELAY_VIEW_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Player link token; the DM app derives it, the relay only compares it. */
export const RELAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
/** WebSocket close code for a player whose link token was withdrawn; the player page stops reconnecting. */
export const RELAY_LINK_REVOKED = 4001;

/**
 * Body of `PUT /api/links`: every valid player link token and the view it shows. It replaces the previous
 * set; sockets of withdrawn tokens close with `RELAY_LINK_REVOKED`, sockets whose view changed with 1013.
 */
export const relayLinksSchema = z.strictObject({
  links: z.record(z.string().regex(RELAY_TOKEN_PATTERN), z.string().regex(RELAY_VIEW_PATTERN)),
});
export type RelayLinks = z.infer<typeof relayLinksSchema>;

/**
 * Frame on the DM socket: the views it concerns, comma-separated, a newline, then the sync message. DM → relay:
 * the relay forwards the message unparsed to the players of these views. Relay → DM: a player's rebuilt hello
 * under that player's view.
 */
export function viewFrame(views: readonly string[], message: string): string {
  return `${views.join(',')}\n${message}`;
}

/** Splits a view frame; null for anything else, e.g. a status frame. */
export function parseViewFrame(text: string): { views: string[]; message: string } | null {
  const end = text.indexOf('\n');
  const views = end > 0 ? text.slice(0, end).split(',') : [];
  const valid = views.length > 0 && views.every((view) => RELAY_VIEW_PATTERN.test(view));
  return valid ? { views, message: text.slice(end + 1) } : null;
}

/** Upload targets are the PUT paths, e.g. `/api/asset/data/library/maps/m1/assets/map.png`. */
export const relayMissingRequestSchema = z.object({
  files: z.array(z.object({ target: z.string(), sha256: z.string() })),
});
export type RelayMissingRequest = z.infer<typeof relayMissingRequestSchema>;
export const relayMissingResponseSchema = z.object({ missing: z.array(z.string()) });

/**
 * Relay → DM status frame on the DM socket, sent on connect and whenever players or links change: all
 * connected players and how many watch each view (views without players are left out).
 */
export const relayStatusSchema = z.strictObject({
  relay: z.strictObject({
    players: z.number().int().nonnegative(),
    views: z.record(z.string(), z.number().int().positive()),
  }),
});
export type RelayStatus = z.infer<typeof relayStatusSchema>;

/** Lowercase extension of a '/'-separated path, '' without one. */
export function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function assetTarget(area: string, path: string): string {
  return `/api/asset/${area}/${encodePath(path)}`;
}

export function bundleTarget(path: string): string {
  return `/api/bundle/${encodePath(path)}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
