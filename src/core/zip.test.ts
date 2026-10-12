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
});
