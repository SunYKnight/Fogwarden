import { z } from 'zod';
import { bytesToHex } from '@/core/binary';
import { assetRefSchema, type AssetRef } from '@/core/model';
import type { SyncPayload } from './protocol';
import {
  assetTarget,
  bundleTarget,
  fileExtension,
  PLAYER_BUNDLE_MANIFEST,
  playerBundleSchema,
  RELAY_API_VERSION,
  RELAY_DM_PROTOCOL,
  RELAY_HASH_HEADER,
  relayMissingResponseSchema,
  relaySessionSchema,
  type RelayLinks,
  type RelayMissingRequest,
  type RelaySession,
} from './relayApi';
import { ViewSocketTransport } from './wsTransport';

/** Reads a stored asset or a built frontend file as bytes. */
export type ReadBytes<T> = (source: T) => Promise<Uint8Array<ArrayBuffer>>;

/** Plain http only to this machine: over the internet it would expose the DM key. */
const LOOPBACK_HOSTS: Record<string, true> = { localhost: true, '127.0.0.1': true, '[::1]': true };

/** `https://host[:port]` without a trailing slash; throws for anything else. */
export function relayBaseUrl(url: string): string {
  const parsed = new URL(url.trim());
  const local = parsed.protocol === 'http:' && LOOPBACK_HOSTS[parsed.hostname] === true;
  if (parsed.protocol !== 'https:' && !local) {
    throw new Error(`The server URL must start with https:// (got ${url})`);
  }
  return parsed.origin;
}

async function relayFetch(baseUrl: string, dmKey: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${dmKey}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }
  return response;
}

/**
 * Checks the DM key and the relay's contract version. Relays before version 2 know only one player link, so they
 * would show every player the party view.
 */
export async function fetchRelaySession(baseUrl: string, dmKey: string): Promise<RelaySession> {
  const response = await relayFetch(baseUrl, dmKey, '/api/session');
  const session = relaySessionSchema.parse(await response.json());
  if (session.api < RELAY_API_VERSION) {
    throw new Error(
      `The relay on ${baseUrl} is outdated (version ${session.api}, the app needs ${RELAY_API_VERSION}). Update ` +
        'it: Server page, Set up a server, run the setup again.',
    );
  }
  if (session.api > RELAY_API_VERSION) {
    throw new Error(`The relay on ${baseUrl} is newer than this app (version ${session.api}); update the app.`);
  }
  return session;
}

/** Replaces the relay's player links: token → view. */
export async function pushRelayLinks(baseUrl: string, dmKey: string, links: Record<string, string>): Promise<void> {
  const body: RelayLinks = { links };
  await relayFetch(baseUrl, dmKey, '/api/links', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Connection test: the relay answers its public health check, then accepts the DM key. */
export async function testRelay(url: string, dmKey: string): Promise<RelaySession> {
  const baseUrl = relayBaseUrl(url);
  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`${baseUrl} answers, but is no DM tool relay (health check: HTTP ${health.status})`);
  }
  return fetchRelaySession(baseUrl, dmKey);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return bytesToHex(digest);
}

const exactAssetRef = assetRefSchema.strict();

/**
 * Every asset reference (`{area, path}`) anywhere in `value`. Walking the whole payload instead of naming
 * fields keeps new asset fields of maps and combatants from silently missing the relay.
 */
export function collectAssetRefs(value: unknown, found: AssetRef[] = []): AssetRef[] {
  const ref = typeof value === 'object' && value !== null && 'path' in value ? exactAssetRef.safeParse(value) : null;
  if (ref?.success) {
    found.push(ref.data);
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) {
      collectAssetRefs(child, found);
    }
  }
  return found;
}

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
/** URIs with a scheme (`data:`, `https:`) are not files next to the model. */
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const fileListSchema = z.array(z.object({ uri: z.string().optional() })).optional();
/** The parts of a glTF document that name external files; everything else passes untouched. */
const gltfFilesSchema = z.object({ buffers: fileListSchema, images: fileListSchema });

function modelFiles(ref: AssetRef, bytes: Uint8Array): z.infer<typeof gltfFilesSchema> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binary = fileExtension(ref.path) === 'glb';
  if (binary && (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== GLB_JSON_CHUNK)) {
    throw new Error(`${ref.path} is not a binary glTF file`);
  }
  const json = binary ? bytes.subarray(20, 20 + view.getUint32(12, true)) : bytes;
  return gltfFilesSchema.parse(JSON.parse(new TextDecoder().decode(json)));
}

/**
 * Buffers and textures a glTF model loads by relative URI; the player's loader requests them next to the
 * model, so they must reach the relay too.
 */
export function modelSideFiles(ref: AssetRef, bytes: Uint8Array): AssetRef[] {
  const { buffers = [], images = [] } = modelFiles(ref, bytes);
  const uris = [...buffers, ...images]
    .map((entry) => entry.uri ?? '')
    .filter((uri) => uri !== '' && !URI_SCHEME.test(uri));
  return uris.map((uri) => {
    const parts = ref.path.split('/').slice(0, -1);
    for (const segment of decodeURIComponent(uri).split('/')) {
      if (segment === '..' && parts.length === 0) {
        throw new Error(`${ref.path} references a file outside its storage area: ${uri}`);
      } else if (segment === '..') {
        parts.pop();
      } else if (segment !== '.' && segment !== '') {
        parts.push(segment);
      }
    }
    return { area: ref.area, path: parts.join('/') };
  });
}

interface Upload {
  target: string;
  sha256: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Uploads assets and the player bundle, skipping files the relay already has with the same SHA-256. */
export class RelayUploader {
  /** Asset keys the relay confirmed during this connection. */
  private readonly confirmed = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly dmKey: string,
    private readonly readAsset: ReadBytes<AssetRef>,
  ) {}

  private async upload(files: Upload[]): Promise<void> {
    const request: RelayMissingRequest = { files: files.map(({ target, sha256 }) => ({ target, sha256 })) };
    const response = await relayFetch(this.baseUrl, this.dmKey, '/api/missing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const missing = new Set(relayMissingResponseSchema.parse(await response.json()).missing);
    // One after another in the given order: the player page must land last.
    for (const file of files.filter((f) => missing.has(f.target))) {
      await relayFetch(this.baseUrl, this.dmKey, file.target, {
        method: 'PUT',
        headers: { [RELAY_HASH_HEADER]: file.sha256 },
        body: file.bytes,
      });
    }
  }

  private async read(ref: AssetRef): Promise<Upload[]> {
    const bytes = await this.readAsset(ref);
    const ext = fileExtension(ref.path);
    const sides = ext === 'gltf' || ext === 'glb' ? modelSideFiles(ref, bytes) : [];
    const own = { target: assetTarget(ref.area, ref.path), sha256: await sha256Hex(bytes), bytes };
    const sideFiles = await Promise.all(sides.map((side) => this.read(side)));
    return [own, ...sideFiles.flat()];
  }

  /** Makes sure the relay holds every asset in `refs` (and model side files) before players need them. */
  async ensure(refs: AssetRef[]): Promise<void> {
    const keys = new Map(refs.map((ref) => [`${ref.area}/${ref.path}`, ref]));
    const fresh = [...keys].filter(([key]) => !this.confirmed.has(key));
    if (fresh.length > 0) {
      const files = await Promise.all(fresh.map(([, ref]) => this.read(ref)));
      await this.upload(files.flat());
      for (const [key] of fresh) {
        this.confirmed.add(key);
      }
    }
  }

  /** Uploads the player page and its chunks listed in the build's bundle manifest. */
  async uploadBundle(readFile: ReadBytes<string>): Promise<void> {
    const manifestBytes = await readFile(PLAYER_BUNDLE_MANIFEST);
    const manifest = playerBundleSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
    const files = await Promise.all(
      manifest.files.map(async ({ path, sha256 }) => ({
        target: bundleTarget(path),
        sha256,
        bytes: await readFile(path),
      })),
    );
    await this.upload(files);
  }
}

/**
 * DM side of the internet relay: a `ViewSocketTransport` (reconnects, resend on reconnect) whose messages
 * wait until the assets they reference are uploaded. An upload failure is reported and the message still
 * goes out, so players keep getting updates while one asset is broken.
 */
export class RelayTransport extends ViewSocketTransport {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    baseUrl: string,
    dmKey: string,
    private readonly uploader: RelayUploader,
    private readonly uploadFailed: (error: unknown) => void,
  ) {
    super(`${baseUrl.replace(/^http/, 'ws')}/ws`, (u) => new WebSocket(u, [RELAY_DM_PROTOCOL, dmKey]));
  }

  override send(views: readonly string[], payload: SyncPayload): void {
    const refs = collectAssetRefs(payload);
    this.queue = this.queue
      .then(() => this.uploader.ensure(refs))
      .catch((error: unknown) => this.uploadFailed(error))
      .then(() => super.send(views, payload));
  }
}
