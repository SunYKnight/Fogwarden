import { describe, expect, it } from 'vitest';
import { createCreature, emptyPlayerSheet } from '@/core/model';
import { sheetFromCreature } from '@/core/rules/characterSheet';
import { dmSheetDetails, sessionSummary } from './DmCharacterSheet';

const creature = {
  ...createCreature('Thorin'),
  kind: 'player' as const,
  level: 5,
  hitPoints: { average: 20, formula: '' },
  traits: [{ name: 'Spellcasting', description: '1st level (4 slots): bless, shield' }],
};
const sheet = {
  ...sheetFromCreature(creature),
  inventory: [{ name: 'Rope', item: null, quantity: 1, equipped: false, attuned: false }],
  currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
};

describe('DM character sheet', () => {
  it("shows the player's item and coin changes, merged as the publisher merges them", () => {
    const overlay = {
      ...emptyPlayerSheet(),
      inventory: { '0': { name: 'Rope', quantity: 3, equipped: true } },
      currency: { gp: 4 },
    };
    const merged = dmSheetDetails(creature, sheet, new Map(), overlay);
    expect(merged.sheet.inventory[0]).toMatchObject({ quantity: 3, equipped: true });
    expect(merged.sheet.currency.gp).toBe(4);
    expect(dmSheetDetails(creature, sheet, new Map(), null).sheet.inventory[0]?.quantity).toBe(1);
  });

  it('says where the character stands between encounters', () => {
    expect(sessionSummary(creature, { ...emptyPlayerSheet(), hitDiceUsed: 2 })).toBe(
      'HP 20/20 · Level 1 slots used 0/4 · Hit dice used 2/5',
    );
    const session = { hp: 0, tempHp: 3, slotsUsed: { '1': 2 }, deathSaves: { successes: 1, failures: 2 } };
    expect(sessionSummary(creature, { ...emptyPlayerSheet(), session })).toBe(
      'HP 0/20, 3 temporary · Level 1 slots used 2/4 · Death saves 1/2 (successes/failures) · Hit dice used 0/5',
    );
  });
});
