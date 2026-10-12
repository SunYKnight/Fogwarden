import { describe, expect, it } from 'vitest';
import { importHandout, listHandouts } from './handouts';
import { MemoryStorage } from './memoryStorage';

const bytes = new Uint8Array([1, 2, 3]);

describe('handouts', () => {
  it("lists the campaign's pictures, videos and text files by name", async () => {
    const storage = new MemoryStorage();
    await storage.writeBytes('campaigns/c1/handouts/map.PNG', bytes);
    await storage.writeText('campaigns/c1/handouts/letter.md', '# Dear Thorin');
    await storage.writeBytes('campaigns/c1/handouts/intro.webm', bytes);
    await storage.writeBytes('campaigns/c1/handouts/notes.docx', bytes);
    await storage.writeBytes('campaigns/c2/handouts/other.png', bytes);
    const listed = await listHandouts(storage, 'c1');
    expect(listed.map((h) => [h.name, h.kind])).toEqual([
      ['intro.webm', 'video'],
      ['letter.md', 'text'],
      ['map.PNG', 'image'],
    ]);
    expect(listed[2]!.asset).toEqual({ area: 'data', path: 'campaigns/c1/handouts/map.PNG' });
  });

  it('keeps an existing handout when a file of the same name is added', async () => {
    const storage = new MemoryStorage();
    expect((await importHandout(storage, 'c1', 'map.png', bytes)).name).toBe('map.png');
    expect((await importHandout(storage, 'c1', 'Map.png', bytes)).name).toBe('Map 2.png');
    await expect(importHandout(storage, 'c1', 'notes.docx', bytes)).rejects.toThrow('no picture, video or text');
  });
});
