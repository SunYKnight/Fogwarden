import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { PLAYER_BUNDLE_MANIFEST, RELAY_PLAYER_PAGE, type PlayerBundle } from '../src/sync/relayApi.ts';

const RELAY_SCRIPT = 'relay.mjs';

/**
 * Ships the internet relay with the app: copies `dist-server/relay.mjs` (from `pnpm build:server`) into the
 * frontend build, which the desktop app deploys over SSH, and lists the files the relay must host for the
 * player page in `player-bundle.json`, which the DM app uploads on connect.
 */
export function relayBundle(relayScript: string): Plugin {
  return {
    name: 'fogwarden-relay-bundle',
    apply: 'build',
    generateBundle() {
      if (!existsSync(relayScript)) {
        this.error(`${relayScript} is missing; run \`pnpm build:server\` first`);
      }
      this.emitFile({ type: 'asset', fileName: RELAY_SCRIPT, source: readFileSync(relayScript) });
    },
    // After writing: hashes cover the files exactly as they land in dist/.
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist';
      const names = Object.keys(bundle).filter(
        (name) => !name.endsWith('.map') && name !== 'index.html' && name !== RELAY_SCRIPT,
      );
      // The page goes last, so the relay never serves it before its chunks.
      const ordered = [...names.filter((n) => n !== RELAY_PLAYER_PAGE), RELAY_PLAYER_PAGE];
      const manifest: PlayerBundle = {
        files: ordered.map((path) => ({
          path,
          sha256: createHash('sha256')
            .update(readFileSync(join(dir, path)))
            .digest('hex'),
        })),
      };
      writeFileSync(join(dir, PLAYER_BUNDLE_MANIFEST), JSON.stringify(manifest, null, 2));
    },
  };
}
