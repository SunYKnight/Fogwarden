import { describe, expect, it } from 'vitest';
import { crc32, readZip, writeZip } from './zip';

const encoder = new TextEncoder();

describe('zip', () => {
  it('reads back what it writes: compressible text deflated, random bytes stored, in order', async () => {
    const text = encoder.encode('goblin '.repeat(500));
    const noise = Uint8Array.from({ length: 300 }, (_, i) => (i * 7919 + 13) % 251);
    const zip = await writeZip([
      { path: 'pack.json', bytes: encoder.encode('{"id":"x"}') },
      { path: 'creatures/goblin.txt', bytes: text },
      { path: 'maps/m/assets/ü.png', bytes: noise },
    ]);
    expect(zip.length).toBeLessThan(text.length);
    const files = await readZip(zip);
    expect(files.map((f) => f.path)).toEqual(['pack.json', 'creatures/goblin.txt', 'maps/m/assets/ü.png']);
    expect(files[1]!.bytes).toEqual(text);
    expect(files[2]!.bytes).toEqual(noise);
  });

  it('writes equal archives for equal files', async () => {
    const files = [{ path: 'a.txt', bytes: encoder.encode('same') }];
    expect(await writeZip(files)).toEqual(await writeZip(files));
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('refuses names that leave the target folder and damaged or foreign data', async () => {
    await expect(writeZip([{ path: '../evil.txt', bytes: new Uint8Array() }])).rejects.toThrow(/Unsafe/);
    await expect(readZip(encoder.encode('not a zip at all, just some text'))).rejects.toThrow(/Not a ZIP/);
    const zip = await writeZip([{ path: 'a.txt', bytes: encoder.encode('hello hello hello') }]);
    const damaged = zip.slice();
    // Local header (30 bytes) and name (5 bytes) come before the data.
    damaged[36] = damaged[36]! ^ 0xff;
    await expect(readZip(damaged)).rejects.toThrow();
  });

  it('refuses names with a colon, which Windows reads as an alternate data stream', async () => {
    await expect(writeZip([{ path: 'maps/a:b.png', bytes: new Uint8Array() }])).rejects.toThrow(/Unsafe/);
  });

  describe('archives that unpack to more than they should', () => {
    async function patched(edit: (view: DataView, central: number) => void): Promise<Uint8Array> {
      const zip = await writeZip([
        { path: 'a.txt', bytes: encoder.encode('a'.repeat(100_000)) },
        { path: 'b.txt', bytes: encoder.encode('b'.repeat(100_000)) },
      ]);
      const view = new DataView(zip.buffer);
      edit(view, view.getUint32(zip.length - 22 + 16, true));
      return zip;
    }

    it('stops inflating an entry at its stated size', async () => {
      const zip = await patched((view, central) => view.setUint32(central + 24, 10, true));
      await expect(readZip(zip)).rejects.toThrow(/unpacks larger than stated/);
    });

    it('refuses entries that share their data', async () => {
      // The second central entry follows the first: 46 bytes plus 'a.txt'.
      const zip = await patched((view, central) => view.setUint32(central + 46 + 5 + 42, 0, true));
      await expect(readZip(zip)).rejects.toThrow(/entries overlap/);
    });

    it('refuses archives stating more than the unpack limit in total', async () => {
      const zip = await patched((view, central) => view.setUint32(central + 24, 0xfffffffe, true));
      await expect(readZip(zip)).rejects.toThrow(/more than the \d+ this app reads/);
    });
  });
});
