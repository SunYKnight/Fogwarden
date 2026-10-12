import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// Installers are copied to artifacts/: the one place build output leaves.
const root = resolve(import.meta.dirname, '..');
const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const artifacts = join(root, 'artifacts');
const packageJson = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
const version = packageJson.version;

function gitRevision(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

const revision = existsSync(join(root, '.git')) ? gitRevision() : 'nogit';
execFileSync('pnpm', ['tauri', 'build'], { cwd: root, stdio: 'inherit', shell: true });

const installers = readdirSync(bundleDir).filter((name) => name.endsWith('.exe'));
if (installers.length === 0) {
  throw new Error(`No installer found in ${bundleDir}`);
}
mkdirSync(artifacts, { recursive: true });
for (const name of installers) {
  const target = join(artifacts, name.replace(/\.exe$/, `-${version}-${revision}.exe`));
  copyFileSync(join(bundleDir, name), target);
  console.log(`Installer: ${target}`);
}
