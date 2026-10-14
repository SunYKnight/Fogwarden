import { describe, expect, it } from 'vitest';
import { serialQueue } from './serialQueue';

describe('serialQueue', () => {
  it('starts each task after the previous one settled, so the second edit sees the first', async () => {
    const queue = serialQueue();
    const firstWrite = Promise.withResolvers<void>();
    let stored = { notes: '', status: 'open' };
    const first = queue(async () => {
      const base = stored;
      await firstWrite.promise;
      stored = { ...base, notes: 'typed' };
    });
    const second = queue(async () => {
      stored = { ...stored, status: 'done' };
    });
    firstWrite.resolve();
    await Promise.all([first, second]);
    expect(stored).toEqual({ notes: 'typed', status: 'done' });
  });

  it('rejects only the failing task and runs the next one', async () => {
    const queue = serialQueue();
    const failed = queue(() => Promise.reject(new Error('disk full')));
    const next = queue(() => Promise.resolve(2));
    await expect(failed).rejects.toThrow('disk full');
    await expect(next).resolves.toBe(2);
  });
});
