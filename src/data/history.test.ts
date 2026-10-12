import { describe, expect, it } from 'vitest';
import { historyDocumentName, historyDocuments, isHistoryPath, restorePlan, type HistoryListing } from './history';
import { MemoryStorage } from './memoryStorage';

const file = (path: string) => ({ path, bytes: 10 });

const listing: HistoryListing = {
  bytes: 50,
  folders: [
    { name: '2026-10-10', files: [file('library/maps/cave/map.json'), file('settings.json')] },
    {
      name: '2026-10-11',
      files: [
        file('library/maps/cave/assets/cave.jpg'),
        file('library/maps/cave/map.json'),
        file('packs/legacy/maps/cave/map.json'),
      ],
    },
    { name: '2026-10-11 14-03-05 before restore', files: [file('library/maps/cave/terrain.png')] },
  ],
};

describe('history documents', () => {
  it('groups kept files by document, telling packs and kinds apart', () => {
    const docs = historyDocuments(listing.folders[1]!);
    expect(docs.map((d) => [d.kind, d.id, d.files.length])).toEqual([
      ['map', 'cave', 2],
      ['map', 'cave', 1],
    ]);
    expect(docs[0]!.key).not.toBe(docs[1]!.key);
  });

  it('restores each file of a document from the first folder on or after the chosen one', () => {
    const map = historyDocuments(listing.folders[0]!)[0]!;
    expect(restorePlan(listing, '2026-10-10', map.key)).toEqual([
      { folder: '2026-10-10', path: 'library/maps/cave/map.json' },
      { folder: '2026-10-11', path: 'library/maps/cave/assets/cave.jpg' },
      { folder: '2026-10-11 14-03-05 before restore', path: 'library/maps/cave/terrain.png' },
    ]);
    expect(restorePlan(listing, '2026-10-11 14-03-05 before restore', map.key)).toEqual([
      { folder: '2026-10-11 14-03-05 before restore', path: 'library/maps/cave/terrain.png' },
    ]);
  });

  it('names a document as it was then, else as it is now', async () => {
    const storage = new MemoryStorage();
    const json = (name: string) => JSON.stringify({ schema: 'map', name });
    storage.files.data.set('history/2026-10-11/library/maps/cave/map.json', json('Old cave'));
    storage.files.data.set('library/maps/cave/map.json', json('Crystal cave'));
    const [map] = historyDocuments(listing.folders[2]!);
    const [, settings] = historyDocuments(listing.folders[0]!);
    expect(await historyDocumentName(storage, listing, '2026-10-11', map!)).toBe('Old cave');
    expect(await historyDocumentName(storage, listing, listing.folders[2]!.name, map!)).toBe('Crystal cave');
    expect(await historyDocumentName(storage, listing, '2026-10-10', settings!)).toBeNull();
  });

  it('recognises history paths in any case', () => {
    expect(isHistoryPath('History/2026-10-11/settings.json')).toBe(true);
    expect(isHistoryPath('./history')).toBe(true);
    expect(isHistoryPath('library/history/x.txt')).toBe(false);
  });
});
