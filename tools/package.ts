import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { gitRevision } from './gitRevision.ts';
import {
  assetName,
  newestChangelogSection,
  platformInstallers,
  platformManifestFile,
  updateManifest,
  type ReleasePlatform,
} from './updateManifest.ts';

// Installers are copied to artifacts/: the one place build output leaves.
const root = resolve(import.meta.dirname, '..');
const bundleRoot = join(root, 'src-tauri', 'target', 'release', 'bundle');
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
const PLATFORM_BY_OS: Partial<Record<NodeJS.Platform, ReleasePlatform>> = {
  win32: 'windows-x86_64',
  linux: 'linux-x86_64',
};

/** The release platform of this machine; releases are built for x64 Windows and Linux only. */
function releasePlatform(): ReleasePlatform {
  const platform = PLATFORM_BY_OS[process.platform];
  if (platform === undefined || process.arch !== 'x64') {
    throw new Error(`No release build on ${process.platform}-${process.arch}: only on x64 Windows and Linux`);
  }
  return platform;
}

/** The updater signing key from the environment, else from the gitignored key file. */
function signingEnv(): NodeJS.ProcessEnv {
  // A CI secret that is not set arrives as an empty variable.
  const fromEnv = process.env.TAURI_SIGNING_PRIVATE_KEY || undefined;
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

// Checked before the build, which takes minutes.
const platform = releasePlatform();
const revision = gitRevision(root);
const notes = newestChangelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
// Running the CLI's script with node needs no shell (pnpm is a .cmd file).
execFileSync(process.execPath, [tauriCli, 'build'], { cwd: root, stdio: 'inherit', env: signingEnv() });

// The bundle folders keep installers of earlier versions and product names.
const installers = platformInstallers(platform, productName, version);
const missing = installers.find((i) => !existsSync(join(bundleRoot, i.folder, i.file)));
if (missing !== undefined) {
  throw new Error(`No installer ${missing.file} in ${join(bundleRoot, missing.folder)}`);
}
mkdirSync(artifacts, { recursive: true });
const assets = installers.map(({ folder, file, target }) => {
  const installer = join(bundleRoot, folder, file);
  const asset = assetName(file, revision);
  copyFileSync(installer, join(artifacts, asset));
  copyFileSync(`${installer}.sig`, join(artifacts, `${asset}.sig`));
  return { target, asset, signature: readFileSync(`${installer}.sig`, 'utf8') };
});
const manifest = `${JSON.stringify(updateManifest({ version, notes, pubDate: new Date(), assets }), null, 2)}\n`;
writeFileSync(join(artifacts, platformManifestFile(platform)), manifest);
// A release of this platform alone is complete with it; `pnpm release:manifest`
// replaces it with the merge of every platform's manifest.
writeFileSync(join(artifacts, 'latest.json'), manifest);
const files = assets.flatMap(({ asset }) => [asset, `${asset}.sig`]);
console.log(`Release v${version} assets in ${artifacts}: ${files.join(', ')}, latest.json`);
