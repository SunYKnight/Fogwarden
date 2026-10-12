import { describe, expect, it } from 'vitest';
import { cardHeightRatio, coverWindow, tokenInitials } from './standee';

describe('cardHeightRatio', () => {
  it('follows the picture between square and 2:3 upright', () => {
    expect(cardHeightRatio(0.8)).toBeCloseTo(1.25);
    expect(cardHeightRatio(2)).toBe(1);
    expect(cardHeightRatio(0.2)).toBe(1.5);
  });
});

describe('coverWindow', () => {
  it('cuts both sides of a too wide picture equally', () => {
    expect(coverWindow(2, 1)).toEqual({ repeatX: 0.5, repeatY: 1, offsetX: 0.25, offsetY: 0 });
  });

  it('keeps the top of a too tall picture', () => {
    const crop = coverWindow(0.25, 0.5);
    expect(crop.repeatX).toBe(1);
    expect(crop.repeatY).toBe(0.5);
    expect(crop.offsetY + crop.repeatY).toBeGreaterThan(0.9);
    expect(crop.offsetY + crop.repeatY).toBeLessThanOrEqual(1);
  });
});

describe('tokenInitials', () => {
  it('uses up to two initials and keeps the number', () => {
    expect(tokenInitials('Goblin 12')).toBe('G12');
    expect(tokenInitials('Adult Red Dragon')).toBe('AR');
    expect(tokenInitials('ambush drake (HotD) 2')).toBe('AD2');
    expect(tokenInitials('   ')).toBe('?');
  });
});
