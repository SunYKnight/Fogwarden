import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef } from '@/core/model';
import { createRelay, type Relay } from '../../server/relayServer';
import { collectAssetRefs, fetchRelaySession, modelSideFiles, relayBaseUrl, RelayUploader } from './relayClient';
import type { PlayerBundle } from './relayApi';

const encode = (text: string) => new TextEncoder().encode(text);

describe('collectAssetRefs', () => {
  it('finds every exact asset reference in a payload', () => {
    const payload = {
      type: 'map',
      map: {
        image: { asset: { area: 'data', path: 'library/maps/m1/assets/map.png' }, widthPx: 10, heightPx: 10 },
        props: [{ id: 'p1', asset: { area: 'content', path: 'models/tree.glb' } }],
        walls: [{ points: [{ x: 1, y: 2 }] }],
      },
      combatants: [{ token: { area: 'data', path: 'library/creatures/assets/goblin.png' } }, { token: null }],
      // Same keys plus more is something else, e.g. a document reference.
      other: { area: 'data', path: 'x.png', id: 'not-an-asset' },
    };
    expect(collectAssetRefs(payload)).toEqual([
      { area: 'data', path: 'library/maps/m1/assets/map.png' },
      { area: 'content', path: 'models/tree.glb' },
      { area: 'data', path: 'library/creatures/assets/goblin.png' },
    ]);
  });
});

describe('modelSideFiles', () => {
  const gltf: AssetRef = { area: 'data', path: 'library/maps/m1/assets/house.gltf' };

  it('resolves buffers and images next to a glTF model and skips embedded or absolute URIs', () => {
    const model = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'house.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
      images: [{ uri: 'textures/roof%20tiles.png' }, { uri: '../shared/wood.png' }, { uri: 'https://x.org/a.png' }],
    };
    expect(modelSideFiles(gltf, encode(JSON.stringify(model)))).toEqual([
      { area: 'data', path: 'library/maps/m1/assets/house.bin' },
      { area: 'data', path: 'library/maps/m1/assets/textures/roof tiles.png' },
      { area: 'data', path: 'library/maps/m1/shared/wood.png' },
    ]);
  });

  it('rejects a model that points outside its storage area', () => {
    const model = { images: [{ uri: '../../../../../secret.png' }] };
    expect(() => modelSideFiles(gltf, encode(JSON.stringify(model)))).toThrow('outside its storage area');
  });

  it('reads the JSON chunk of a binary glTF', () => {
    const json = encode(JSON.stringify({ images: [{ uri: 'skin.png' }] }));
    const glb = new Uint8Array(20 + json.length);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(12, json.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    glb.set(json, 20);
    expect(modelSideFiles({ area: 'content', path: 'models/orc.glb' }, glb)).toEqual([
      { area: 'content', path: 'models/skin.png' },
    ]);
    expect(() => modelSideFiles({ area: 'content', path: 'models/bad.glb' }, new Uint8Array(24))).toThrow(
      'not a binary glTF',
    );
  });
});

describe('relayBaseUrl', () => {
  it('accepts https anywhere and plain http on this machine only', () => {
    expect(relayBaseUrl(' https://fogwarden.example.org/ ')).toBe('https://fogwarden.example.org');
    expect(relayBaseUrl('http://127.0.0.1:7718/x')).toBe('http://127.0.0.1:7718');
    expect(() => relayBaseUrl('http://fogwarden.example.org')).toThrow('https://');
  });
});

describe('RelayUploader', () => {
  it('never uploads kept versions from the history', async () => {
    const readAsset = vi.fn(async () => encode('PNG'));
    const uploader = new RelayUploader('https://relay.test', 'k', readAsset);
    const kept: AssetRef = { area: 'data', path: 'History/2026-10-12/library/maps/m1/assets/map.png' };
    await expect(uploader.ensure([kept])).rejects.toThrow('never leaves this computer');
    expect(readAsset).not.toHaveBeenCalled();
  });
});

describe('fetchRelaySession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks to update a relay from before per-view links', async () => {
    // Version 1 answered with its single player token and no version.
    vi.stubGlobal('fetch', async () => Response.json({ token: 'abc', players: 0 }));
    await expect(fetchRelaySession('https://relay.test', 'k')).rejects.toThrow(/outdated.*run the setup again/);
  });

  it('asks to update the app for a newer relay', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ api: 99, players: 0 }));
    await expect(fetchRelaySession('https://relay.test', 'k')).rejects.toThrow('update the app');
  });
});

describe('RelayUploader against the relay', () => {
  const DM_KEY = 'k'.repeat(64);
  const PLAYER_TOKEN = 'player_0123456789abcdef';
  let dataDir: string;
  let relay: Relay;
  let base: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'relay-client-'));
    relay = await createRelay({ dmKey: DM_KEY, dataDir });
    const { promise, resolve } = Promise.withResolvers<void>();
    relay.server.listen(0, '127.0.0.1', resolve);
    await promise;
    base = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await relay.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const files: Record<string, Uint8Array<ArrayBuffer>> = {
    'data/maps/house.gltf': encode(JSON.stringify({ buffers: [{ uri: 'house.bin' }], images: [{ uri: 'wall.png' }] })),
    'data/maps/house.bin': new Uint8Array([1, 2, 3]),
    'data/maps/wall.png': new Uint8Array([4, 5]),
  };
  const readAsset = (ref: AssetRef) => Promise.resolve(files[`${ref.area}/${ref.path}`] ?? new Uint8Array());
  const puts = (spy: { mock: { calls: Parameters<typeof fetch>[] } }) =>
    spy.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([url]) => String(url).slice(base.length));
  const addPlayerLink = async () => {
    const response = await fetch(`${base}/api/links`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${DM_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ links: { [PLAYER_TOKEN]: 'party' } }),
    });
    expect(response.status).toBe(204);
  };

  it('uploads a model with its side files once and skips them on the next connection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const model: AssetRef = { area: 'data', path: 'maps/house.gltf' };
    await new RelayUploader(base, DM_KEY, readAsset).ensure([model, model]);
    expect(puts(fetchSpy).sort()).toEqual([
      '/api/asset/data/maps/house.bin',
      '/api/asset/data/maps/house.gltf',
      '/api/asset/data/maps/wall.png',
    ]);

    await addPlayerLink();
    const served = await fetch(`${base}/asset/data/maps/house.bin`, {
      headers: { cookie: `fogwarden-relay=${PLAYER_TOKEN}` },
    });
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(files['data/maps/house.bin']);

    fetchSpy.mockClear();
    await new RelayUploader(base, DM_KEY, readAsset).ensure([model]);
    expect(puts(fetchSpy)).toEqual([]);
  });

  it('uploads the player bundle with the page last and only changed files later', async () => {
    const bundle: Record<string, Uint8Array<ArrayBuffer>> = {
      'assets/player-1.js': encode('chunk'),
      'player.html': encode('<script src="/assets/player-1.js"></script>'),
    };
    const sha = async (bytes: Uint8Array<ArrayBuffer>) =>
      Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    const manifest: PlayerBundle = {
      files: await Promise.all(
        Object.entries(bundle).map(async ([path, bytes]) => ({ path, sha256: await sha(bytes) })),
      ),
    };
    const readFile = (path: string) =>
      Promise.resolve(path === 'player-bundle.json' ? encode(JSON.stringify(manifest)) : (bundle[path] ?? encode('')));

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await new RelayUploader(base, DM_KEY, readAsset).uploadBundle(readFile);
    expect(puts(fetchSpy)).toEqual(['/api/bundle/assets/player-1.js', '/api/bundle/player.html']);
    await addPlayerLink();
    expect(await (await fetch(`${base}/?t=${PLAYER_TOKEN}`)).text()).toContain('player-1.js');

    fetchSpy.mockClear();
    await new RelayUploader(base, DM_KEY, readAsset).uploadBundle(readFile);
    expect(puts(fetchSpy)).toEqual([]);
  });
});
