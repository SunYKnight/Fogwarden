import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Repository } from '../src/data/repository';
import { StorageError } from '../src/data/storage';
import { CONTENT_ROOT, PROJECT_ROOT } from './cli';
import { NodeStorage } from './nodeStorage';

const scratchParent = join(PROJECT_ROOT, 'data-local');
mkdirSync(scratchParent, { recursive: true });
const scratch = mkdtempSync(join(scratchParent, 'tools-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('shipped SRD content', () => {
  const repository = new Repository(new NodeStorage(scratch, CONTENT_ROOT));

  it('loads every creature and marker without problems', async () => {
    const creatures = await repository.list('creature');
    const markers = await repository.list('marker');
    expect(creatures.problems).toEqual([]);
    expect(markers.problems).toEqual([]);
    expect(creatures.entries.length).toBeGreaterThanOrEqual(300);
    expect(creatures.entries.every((e) => e.doc.license === 'CC-BY-4.0' && e.ref.area === 'content')).toBe(true);
    expect(markers.entries.map((e) => [e.doc.name, e.doc.shape, e.doc.sizeFt])).toEqual([
      ['Burning Hands', 'cone', 15],
      ['Fireball', 'sphere', 20],
      ['Lightning Bolt', 'line', 100],
      ['Moonbeam', 'cylinder', 5],
      ['Thunderwave', 'cube', 15],
    ]);
    expect(existsSync(join(CONTENT_ROOT, 'LICENSE-SRD.md'))).toBe(true);
  });
});

describe('NodeStorage', () => {
  const storage = new NodeStorage(scratch, CONTENT_ROOT);

  it('writes atomically without leaving temp files and lists sorted entries', async () => {
    await storage.writeText('a/b.json', '1');
    await storage.writeText('a/b.json', '2');
    await storage.writeBytes('a/A.bin', new Uint8Array([1]));
    expect(await storage.readText('data', 'a/b.json')).toBe('2');
    expect(readdirSync(join(scratch, 'a'))).not.toContain('b.json.tmp');
    expect(await storage.list('data', 'a')).toEqual([
      { name: 'A.bin', isDir: false },
      { name: 'b.json', isDir: false },
    ]);
    expect(await storage.list('data', 'missing')).toEqual([]);
  });

  it('refuses paths that leave the storage root', async () => {
    await expect(storage.readText('data', '../outside.json')).rejects.toThrow(StorageError);
    await expect(storage.writeText('a/../../x', '')).rejects.toThrow(StorageError);
    await expect(storage.writeText('C:/x', '')).rejects.toThrow(StorageError);
    await expect(storage.remove('')).rejects.toThrow(StorageError);
  });
});
