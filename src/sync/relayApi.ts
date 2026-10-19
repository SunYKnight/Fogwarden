import { z } from 'zod';

/**
 * HTTP and WebSocket contract between the DM app and the internet relay (`server/`). Both sides import it, so
 * the routes, limits and allowed file types cannot drift apart.
 */

/** WebSocket subprotocol naming the DM; the DM key travels as a second subprotocol, never in a logged URL. */
export const RELAY_DM_PROTOCOL = 'fogwarden-dm';
/** Upload limit per file, room for video battlemaps; the generated nginx site allows the same body size. */
export const RELAY_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
/** Lowercase hex SHA-256 of the request body, required on every upload. */
export const RELAY_HASH_HEADER = 'x-content-sha256';
/** Cookie scoped to `/asset` so glTF side files, requested without the query, still carry the token. */
export const RELAY_TOKEN_COOKIE = 'fogwarden-relay';
/** Player page query parameter; short because players type the link. */
export const RELAY_LINK_PARAM = 't';

/**
 * Map images, tokens, models, audio and video: the same set the LAN server serves (`asset_mime` in
 * `src-tauri/src/lan.rs`).
 */
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
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
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
  files: z.array(z.object({ path: z.string() })),
});
export type PlayerBundle = z.infer<typeof playerBundleSchema>;

/**
 * Version of this contract. 2: per-view player links (`PUT /api/links`) and view-routed frames on the DM
 * socket. 3: players may also send rolls, pings and token moves (`rebuildPlayerMessage`). 4: a player's hello may
 * name its map revision; older relays close such a socket. 5: players upload pictures for the DM to review
 * (`PUT /api/player-upload/{name}?token=`, uploads frames on the DM socket, `uploads` in the links), and chat,
 * keep notes, share rolls and edit their own sheet (more `rebuildPlayerMessage` types, same number since 5 was
 * never released without them). The app refuses relays that report another version.
 */
export const RELAY_API_VERSION = 5;

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
 * Body of `PUT /api/links`: every valid player link token and the view it shows, and the views whose players may
 * upload pictures. It replaces the previous set; sockets of withdrawn tokens close with `RELAY_LINK_REVOKED`,
 * sockets whose view changed with 1013.
 */
export const relayLinksSchema = z.strictObject({
  links: z.record(z.string().regex(RELAY_TOKEN_PATTERN), z.string().regex(RELAY_VIEW_PATTERN)),
  // Links files of relays before version 5 have no uploads.
  uploads: z.array(z.string().regex(RELAY_VIEW_PATTERN)).default([]),
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

/** Player uploads: pictures for the DM to review, never shown to anyone before the DM accepts them. */
export const PLAYER_UPLOAD_ROUTE = '/api/player-upload';
export const PLAYER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Uploads of one view waiting for the DM; more are refused until the DM accepts or rejects some. */
export const PLAYER_UPLOAD_MAX_PENDING = 20;
/** File name length the DM sees; the name is shown only, never part of a stored path. */
export const PLAYER_UPLOAD_NAME_MAX = 100;
/** Bytes `sniffPicture` needs. */
export const PLAYER_UPLOAD_SNIFF_BYTES = 12;
/** Upload id the server generates: 128 random bits as hex. */
export const PLAYER_UPLOAD_ID_PATTERN = /^[0-9a-f]{32}$/;
export const PLAYER_UPLOAD_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
export type PlayerUploadType = keyof typeof PLAYER_UPLOAD_TYPES;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, magic: number[], at = 0): boolean {
  return magic.every((byte, i) => bytes[at + i] === byte);
}

/**
 * Picture type by its first bytes, null for anything else: the extension a player's file has proves nothing.
 * `sniff_picture` in `src-tauri/src/lan.rs` mirrors it.
 */
export function sniffPicture(bytes: Uint8Array): PlayerUploadType | null {
  const webp = startsWith(bytes, RIFF_MAGIC) && startsWith(bytes, WEBP_MAGIC, 8);
  return startsWith(bytes, PNG_MAGIC) ? 'png' : startsWith(bytes, JPEG_MAGIC) ? 'jpg' : webp ? 'webp' : null;
}

// Separators, drive colons and control characters: the name never becomes
// a path, yet nothing in it could lead anywhere if it did.
function forbiddenInName(char: string): boolean {
  return '/\\:'.includes(char) || char < ' ' || char === '\u007f';
}

/**
 * Whether a player's file name may be shown to the DM: none of the characters above and no leading dot (`.`,
 * `..`, hidden files). `upload_name_valid` in `lan.rs` mirrors it.
 */
export function isPlayerUploadName(name: string): boolean {
  const fits = name.length > 0 && name.length <= PLAYER_UPLOAD_NAME_MAX;
  return fits && !name.startsWith('.') && !Array.from(name).some(forbiddenInName);
}

/**
 * A file name `isPlayerUploadName` accepts, made from the name of the player's file: forbidden characters become
 * `_`, leading dots go, and long names are cut between characters.
 */
export function playerUploadName(fileName: string): string {
  const cleaned = Array.from(fileName, (char) => (forbiddenInName(char) ? '_' : char))
    .join('')
    .replace(/^\.+/, '');
  const { name } = Array.from(cleaned).reduce(
    (cut, char) =>
      cut.full || cut.name.length + char.length > PLAYER_UPLOAD_NAME_MAX
        ? { name: cut.name, full: true }
        : { name: cut.name + char, full: false },
    { name: '', full: false },
  );
  return name === '' ? 'picture' : name;
}

/** A picture a player uploaded, waiting on the server until the DM accepts or rejects it. */
export const playerUploadSchema = z.strictObject({
  id: z.string().regex(PLAYER_UPLOAD_ID_PATTERN),
  view: z.string().regex(RELAY_VIEW_PATTERN),
  name: z.string().refine(isPlayerUploadName),
  type: z.enum(['png', 'jpg', 'webp']),
  size: z.number().int().positive().max(PLAYER_UPLOAD_MAX_BYTES),
  /** Milliseconds since 1970. */
  at: z.number().int().nonnegative(),
});
export type PlayerUpload = z.infer<typeof playerUploadSchema>;

/**
 * Relay → DM uploads frame on the DM socket, sent on connect and whenever an upload arrives or is deleted: every
 * waiting upload of every view, oldest first.
 */
export const relayUploadsSchema = z.strictObject({ uploads: z.array(playerUploadSchema) });
export type RelayUploads = z.infer<typeof relayUploadsSchema>;

/** Anything on the DM socket that is not a view frame. */
export const relayNoticeSchema = z.union([relayStatusSchema, relayUploadsSchema]);

/**
 * Player: `PUT` with the file name and `?token=`. DM: `GET` (bytes) and `DELETE` with the upload id and the DM
 * key.
 */
export function playerUploadTarget(nameOrId: string): string {
  return `${PLAYER_UPLOAD_ROUTE}/${encodeURIComponent(nameOrId)}`;
}

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
