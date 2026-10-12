import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { gitRevision } from './gitRevision.ts';
import { newestChangelogSection, updateManifest } from './updateManifest.ts';

// Installers are copied to artifacts/: the one place build output leaves.
const root = resolve(import.meta.dirname, '..');
const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const artifacts = join(root, 'artifacts');
const tauriCli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const keyFile = join(root, 'data-local', 'signing', 'fogwarden.key');
const packageJson = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
const version = packageJson.version;
const { productName } = z
  .object({ productName: z.string() })
  .parse(JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')));

/** The updater signing key from the environment, else from the gitignored key file. */
function signingEnv(): NodeJS.ProcessEnv {
  const fromEnv = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (fromEnv === undefined && !existsSync(keyFile)) {
    throw new Error(
      `No updater signing key: set TAURI_SIGNING_PRIVATE_KEY or create ${keyFile} (see README, "Release")`,
    );
  }
  return {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: fromEnv ?? readFileSync(keyFile, 'utf8'),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
  };
}

const revision = gitRevision(root);
// Running the CLI's script with node avoids a shell (pnpm is a .cmd on Windows).
execFileSync(process.execPath, [tauriCli, 'build'], { cwd: root, stdio: 'inherit', env: signingEnv() });

// The bundle folder keeps installers of earlier versions and product names.
const installer = `${productName}_${version}_x64-setup.exe`;
if (!existsSync(join(bundleDir, installer))) {
  throw new Error(`No installer ${installer} in ${bundleDir}`);
}
const asset = installer.replace(/\.exe$/, `-${revision}.exe`);
mkdirSync(artifacts, { recursive: true });
copyFileSync(join(bundleDir, installer), join(artifacts, asset));
copyFileSync(join(bundleDir, `${installer}.sig`), join(artifacts, `${asset}.sig`));
const manifest = updateManifest({
  version,
  notes: newestChangelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')),
  pubDate: new Date(),
  signature: readFileSync(join(bundleDir, `${installer}.sig`), 'utf8'),
  installer: asset,
});
writeFileSync(join(artifacts, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release v${version} assets in ${artifacts}: ${asset}, ${asset}.sig, latest.json`);
