/** Floors towards negative infinity: score 9 gives -1, not 0. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** Monster proficiency bonus by challenge rating (MM table: +2 up to CR 4, then +1 every 4 CR). */
export function proficiencyBonusForCr(cr: number): number {
  return cr < 1 ? 2 : Math.floor((cr - 1) / 4) + 2;
}

const XP_BY_CR: Record<string, number> = {
  '0': 10,
  '0.125': 25,
  '0.25': 50,
  '0.5': 100,
  '1': 200,
  '2': 450,
  '3': 700,
  '4': 1100,
  '5': 1800,
  '6': 2300,
  '7': 2900,
  '8': 3900,
  '9': 5000,
  '10': 5900,
  '11': 7200,
  '12': 8400,
  '13': 10000,
  '14': 11500,
  '15': 13000,
  '16': 15000,
  '17': 18000,
  '18': 20000,
  '19': 22000,
  '20': 25000,
  '21': 33000,
  '22': 41000,
  '23': 50000,
  '24': 62000,
  '25': 75000,
  '26': 90000,
  '27': 105000,
  '28': 120000,
  '29': 135000,
  '30': 155000,
};

export function xpForCr(cr: number): number {
  const xp = XP_BY_CR[String(cr)];
  if (xp === undefined) {
    throw new RangeError(`No XP value for challenge rating ${cr}`);
  }
  return xp;
}

const FRACTION_CR: Record<string, string> = { '0.125': '1/8', '0.25': '1/4', '0.5': '1/2' };

export function formatCr(cr: number): string {
  return FRACTION_CR[String(cr)] ?? String(cr);
}
