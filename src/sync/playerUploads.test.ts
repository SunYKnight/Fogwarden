import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '@/data/memoryStorage';
import { checkPlayerUpload, storePlayerUpload } from './playerUploads';
import { isPlayerUploadName, playerUploadName, sniffPicture, type PlayerUpload } from './relayApi';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
const upload: PlayerUpload = {
  id: 'a'.repeat(32),
  view: 'thorin',
  name: 'me.png',
  type: 'png',
  size: PNG.length,
  at: 1,
};

describe('player upload checks', () => {
  it('knows pictures by their first bytes only', () => {
    expect([PNG, JPEG, WEBP].map(sniffPicture)).toEqual(['png', 'jpg', 'webp']);
    const others = ['GIF89a and more', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'RIFF\0\0\0\0WAVEfmt ', ''];
    expect(others.map((text) => sniffPicture(new TextEncoder().encode(text)))).toEqual([null, null, null, null]);
  });

  it('shows the DM only names that lead nowhere, and makes such names from any file name', () => {
    expect(isPlayerUploadName('Thorin portrait.png')).toBe(true);
    for (const name of ['', '../x.png', 'a/b', 'a\\b', '.hidden', 'C:x', 'a\0b', 'x'.repeat(101)]) {
      expect(isPlayerUploadName(name), name).toBe(false);
    }
    expect(playerUploadName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(playerUploadName('...')).toBe('picture');
    const long = playerUploadName(`${'x'.repeat(99)}😀.png`);
    expect(long).toBe('x'.repeat(99));
    expect(isPlayerUploadName(long)).toBe(true);
  });

  it('refuses fetched bytes that differ from what the server announced', () => {
    expect(() => checkPlayerUpload(upload, PNG)).not.toThrow();
    expect(() => checkPlayerUpload(upload, PNG.subarray(0, 10))).toThrow('has 10 bytes instead of the announced 14');
    expect(() => checkPlayerUpload({ ...upload, size: JPEG.length }, JPEG)).toThrow('is no PNG picture');
  });

  it("stores an accepted picture under the view's folder by its id, never by the player's file name", async () => {
    const storage = new MemoryStorage();
    const named = { ...upload, name: 'evil..png' };
    const ref = await storePlayerUpload(storage, 'red-hand', named, PNG);
    expect(ref).toEqual({ area: 'data', path: `campaigns/red-hand/players/thorin/uploads/${upload.id}.png` });
    expect(storage.files.data.get(ref.path)).toEqual(PNG);
    await expect(storePlayerUpload(storage, 'red-hand', { ...upload, type: 'webp' }, PNG)).rejects.toThrow('WEBP');
    expect(storage.files.data.size).toBe(1);
  });
});
