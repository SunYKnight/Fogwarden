import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { Repository } from '../src/data/repository';
import { NodeStorage } from './nodeStorage';

const APP_IDENTIFIER = 'de.dnddmtool.desktop';
export const PROJECT_ROOT = resolve(import.meta.dirname, '..');
export const CONTENT_ROOT = join(PROJECT_ROOT, 'content');

/** The desktop app's data root: its bootstrap override if the user moved it, else Tauri's app data dir. */
function defaultDataRoot(): string {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('APPDATA is not set; pass --data-root <path>');
  }
  const appDir = join(appData, APP_IDENTIFIER);
  const bootstrap = join(appDir, 'bootstrap.json');
  return existsSync(bootstrap)
    ? z.object({ dataRoot: z.string() }).parse(JSON.parse(readFileSync(bootstrap, 'utf8'))).dataRoot
    : appDir;
}

export function openRepository(dataRoot: string | undefined): { repository: Repository; dataRoot: string } {
  const root = resolve(dataRoot ?? defaultDataRoot());
  return { repository: new Repository(new NodeStorage(root, CONTENT_ROOT)), dataRoot: root };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
