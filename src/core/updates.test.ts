import { describe, expect, it } from 'vitest';
import { autoCheckDecision } from './updates';

const now = new Date('2026-10-12T18:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();

describe('automatic update check', () => {
  it('checks on the first start', () => {
    expect(autoCheckDecision({ autoCheck: true, lastCheck: null }, now, false)).toBe('check');
  });

  it('checks at most once a day', () => {
    expect(autoCheckDecision({ autoCheck: true, lastCheck: hoursAgo(23) }, now, false)).toBe('skip');
    expect(autoCheckDecision({ autoCheck: true, lastCheck: hoursAgo(24) }, now, false)).toBe('check');
  });

  it('skips a last check in the future after the clock was set back', () => {
    expect(autoCheckDecision({ autoCheck: true, lastCheck: hoursAgo(-5) }, now, false)).toBe('skip');
  });

  it('waits while combat runs in Play', () => {
    expect(autoCheckDecision({ autoCheck: true, lastCheck: hoursAgo(48) }, now, true)).toBe('wait');
    expect(autoCheckDecision({ autoCheck: true, lastCheck: hoursAgo(1) }, now, true)).toBe('skip');
  });

  it('never checks when switched off', () => {
    expect(autoCheckDecision({ autoCheck: false, lastCheck: null }, now, false)).toBe('skip');
    expect(autoCheckDecision({ autoCheck: false, lastCheck: null }, now, true)).toBe('skip');
  });
});
