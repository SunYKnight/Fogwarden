import { describe, expect, it } from 'vitest';
import { encounterDifficulty, partyThresholds, splitXp, xpMultiplier } from './difficulty';

describe('encounter difficulty', () => {
  it('adds the DMG thresholds of every character', () => {
    expect(partyThresholds([1, 1, 1, 1])).toEqual({ easy: 100, medium: 200, hard: 300, deadly: 400 });
    expect(partyThresholds([3, 3, 4])).toEqual({ easy: 275, medium: 550, hard: 825, deadly: 1300 });
  });

  it('multiplies by monster count for parties of three to five', () => {
    const multipliers = [1, 2, 3, 6, 7, 10, 11, 14, 15].map((n) => xpMultiplier(n, 4));
    expect(multipliers).toEqual([1, 1.5, 2, 2, 2.5, 2.5, 3, 3, 4]);
  });

  it('uses the next higher multiplier for small parties and the next lower for large ones', () => {
    expect(xpMultiplier(1, 2)).toBe(1.5);
    expect(xpMultiplier(15, 1)).toBe(5);
    expect(xpMultiplier(1, 6)).toBe(0.5);
    expect(xpMultiplier(4, 6)).toBe(1.5);
  });

  it('rates four level 1 characters against goblins (DMG example numbers)', () => {
    const party = [1, 1, 1, 1];
    expect(encounterDifficulty(party, [50])?.difficulty).toBe('trivial');
    expect(encounterDifficulty(party, [50, 50])?.difficulty).toBe('easy');
    const three = encounterDifficulty(party, [50, 50, 50]);
    expect(three).toEqual({
      difficulty: 'hard',
      baseXp: 150,
      adjustedXp: 300,
      multiplier: 2,
      thresholds: { easy: 100, medium: 200, hard: 300, deadly: 400 },
    });
    expect(encounterDifficulty(party, [200])?.difficulty).toBe('medium');
    expect(encounterDifficulty(party, [200, 50, 50])?.difficulty).toBe('deadly');
  });

  it('has no rating without a party', () => {
    expect(encounterDifficulty([], [50])).toBeNull();
  });

  it('splits XP into equal whole shares', () => {
    expect(splitXp(450, 3)).toBe(150);
    expect(splitXp(100, 3)).toBe(33);
    expect(splitXp(100, 0)).toBe(0);
  });
});
