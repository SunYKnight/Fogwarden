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

export const relaySessionSchema = z.object({
  /** Player join token, kept by the relay across restarts. */
  token: z.string(),
  players: z.number().int().nonnegative(),
});
export type RelaySession = z.infer<typeof relaySessionSchema>;

/** Upload targets are the PUT paths, e.g. `/api/asset/data/library/maps/m1/assets/map.png`. */
export const relayMissingRequestSchema = z.object({
  files: z.array(z.object({ target: z.string(), sha256: z.string() })),
});
export type RelayMissingRequest = z.infer<typeof relayMissingRequestSchema>;
export const relayMissingResponseSchema = z.object({ missing: z.array(z.string()) });

/**
 * Relay → DM status frame on the DM socket. It has no `protocol` field, so `WebSocketTransport` ignores it as a
 * sync message.
 */
export const relayStatusSchema = z.strictObject({ relay: z.strictObject({ players: z.number().int().nonnegative() }) });
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
