import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInterlude } from '@/sync/protocol';
import { usePlayerStore } from './playerStore';

const video = { area: 'data', path: 'videos/intro.mp4' } as const;

afterEach(() => {
  vi.useRealTimers();
  usePlayerStore.setState({ interlude: null });
});

describe('usePlayerStore', () => {
  it('keeps a running interlude when a resend repeats it and restarts it when the DM starts it again', () => {
    vi.useFakeTimers();
    const receive = (interlude: PlayerInterlude | null) =>
      usePlayerStore.getState().receive({ type: 'interlude', interlude });
    receive({ id: 1, asset: video, positionSec: 0 });
    const running = usePlayerStore.getState().interlude;
    vi.advanceTimersByTime(5000);
    receive({ id: 1, asset: video, positionSec: 5 });
    expect(usePlayerStore.getState().interlude).toBe(running);

    receive({ id: 2, asset: video, positionSec: 0 });
    expect(usePlayerStore.getState().interlude?.value.id).toBe(2);
    receive(null);
    expect(usePlayerStore.getState().interlude).toBeNull();
  });
});
