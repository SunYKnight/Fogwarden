import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The app version lives in four files; a release changes them together.
const root = resolve(import.meta.dirname, '..');
const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Usage: pnpm set-version <major.minor.patch>');
}

/** Replaces the version in the first match of `pattern` (quote groups 1 and 2) in a project file. */
function setIn(file: string, pattern: RegExp) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  if (!pattern.test(text)) {
    throw new Error(`No version found in ${file}`);
  }
  writeFileSync(path, text.replace(pattern, `$1${version}$2`));
}

setIn('package.json', /^( {2}"version": ")[^"]*(")/m);
setIn('src-tauri/tauri.conf.json', /^( {2}"version": ")[^"]*(")/m);
setIn('src-tauri/Cargo.toml', /^(\[package\][^[]*?\nversion = ")[^"]*(")/m);
setIn('src-tauri/Cargo.lock', /^(name = "fogwarden"\r?\nversion = ")[^"]*(")/m);
console.log(
  `Version ${version} set in package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml and src-tauri/Cargo.lock`,
);
