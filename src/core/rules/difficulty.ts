/** 5e (DMG 2014) encounter difficulty from party levels and monster XP. */

export type Difficulty = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';

export interface XpThresholds {
  easy: number;
  medium: number;
  hard: number;
  deadly: number;
}

// DMG 2014 p. 82, one row per level 1 to 20: easy, medium, hard, deadly.
const THRESHOLDS_BY_LEVEL: readonly (readonly [number, number, number, number])[] = [
  [25, 50, 75, 100],
  [50, 100, 150, 200],
  [75, 150, 225, 400],
  [125, 250, 375, 500],
  [250, 500, 750, 1100],
  [300, 600, 900, 1400],
  [350, 750, 1100, 1700],
  [450, 900, 1400, 2100],
  [550, 1100, 1600, 2400],
  [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600],
  [1000, 2000, 3000, 4500],
  [1100, 2200, 3400, 5100],
  [1250, 2500, 3800, 5700],
  [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200],
  [2000, 3900, 5900, 8800],
  [2100, 4200, 6300, 9500],
  [2400, 4900, 7300, 10900],
  [2800, 5700, 8500, 12700],
];

// DMG p. 82 multipliers plus the extra steps for small and large parties.
const MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

/** Index into `MULTIPLIERS` for a party of three to five. */
function multiplierStep(monsters: number): number {
  return monsters <= 1 ? 1 : monsters === 2 ? 2 : monsters <= 6 ? 3 : monsters <= 10 ? 4 : monsters <= 14 ? 5 : 6;
}

/** Fewer than three characters use the next higher multiplier, six or more the next lower. */
export function xpMultiplier(monsters: number, partySize: number): number {
  const shift = partySize < 3 ? 1 : partySize >= 6 ? -1 : 0;
  return monsters === 0 ? 0 : MULTIPLIERS[multiplierStep(monsters) + shift]!;
}

export function partyThresholds(levels: readonly number[]): XpThresholds {
  return levels.reduce<XpThresholds>(
    (sum, level) => {
      const row = THRESHOLDS_BY_LEVEL[Math.min(20, Math.max(1, level)) - 1]!;
      return {
        easy: sum.easy + row[0],
        medium: sum.medium + row[1],
        hard: sum.hard + row[2],
        deadly: sum.deadly + row[3],
      };
    },
    { easy: 0, medium: 0, hard: 0, deadly: 0 },
  );
}

export interface DifficultyReport {
  difficulty: Difficulty;
  /** Sum of the monsters' XP, what the party earns. */
  baseXp: number;
  /** Base XP times the multiplier, compared with the thresholds. */
  adjustedXp: number;
  multiplier: number;
  thresholds: XpThresholds;
}

/** Difficulty for a party of `levels` against monsters worth `monsterXp` each; null without a party. */
export function encounterDifficulty(levels: readonly number[], monsterXp: readonly number[]): DifficultyReport | null {
  const thresholds = partyThresholds(levels);
  const baseXp = monsterXp.reduce((a, b) => a + b, 0);
  const multiplier = xpMultiplier(monsterXp.length, levels.length);
  const adjustedXp = baseXp * multiplier;
  const difficulty: Difficulty =
    adjustedXp >= thresholds.deadly
      ? 'deadly'
      : adjustedXp >= thresholds.hard
        ? 'hard'
        : adjustedXp >= thresholds.medium
          ? 'medium'
          : adjustedXp >= thresholds.easy
            ? 'easy'
            : 'trivial';
  return levels.length > 0 ? { difficulty, baseXp, adjustedXp, multiplier, thresholds } : null;
}

/** Equal whole shares for every character; the remainder is lost like a split coin. */
export function splitXp(total: number, characters: number): number {
  return characters > 0 ? Math.floor(total / characters) : 0;
}
