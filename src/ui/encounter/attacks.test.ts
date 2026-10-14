import { describe, expect, it } from 'vitest';
import { rollDice } from '@/core/rules/dice';
import type { AttackResult } from '@/state/encounterActions';
import { attackOutcome } from './attacks';

/** An attack with +5 to hit whose d20 shows `natural`. */
function attack(natural: number): AttackResult {
  const toHit = rollDice('1d20+5', { rng: () => (natural - 0.5) / 20 });
  return { toHit, critical: natural === 20, damage: [], text: '' };
}

describe('attackOutcome', () => {
  it('hits when the total reaches the armor class', () => {
    expect(attackOutcome(attack(10), 15)).toBe('hit');
    expect(attackOutcome(attack(9), 15)).toBe('miss');
  });

  it('hits on a natural 20 and misses on a natural 1 whatever the armor class', () => {
    expect(attackOutcome(attack(20), 30)).toBe('critical');
    expect(attackOutcome(attack(1), 2)).toBe('fumble');
  });
});
