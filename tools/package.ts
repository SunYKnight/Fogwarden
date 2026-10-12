import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { gitRevision } from './gitRevision.ts';

// Installers are copied to artifacts/: the one place build output leaves.
const root = resolve(import.meta.dirname, '..');
const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const artifacts = join(root, 'artifacts');
const tauriCli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const packageJson = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
const version = packageJson.version;

const revision = gitRevision(root);
// Running the CLI's script with node avoids a shell (pnpm is a .cmd on Windows).
execFileSync(process.execPath, [tauriCli, 'build'], { cwd: root, stdio: 'inherit' });

// The bundle folder keeps installers of earlier versions; only this version ships.
const installers = readdirSync(bundleDir).filter((name) => name.endsWith('.exe') && name.includes(`_${version}_`));
if (installers.length === 0) {
  throw new Error(`No installer for version ${version} found in ${bundleDir}`);
}
mkdirSync(artifacts, { recursive: true });
for (const name of installers) {
  const target = join(artifacts, name.replace(/\.exe$/, `-${revision}.exe`));
  copyFileSync(join(bundleDir, name), target);
  console.log(`Installer: ${target}`);
}
