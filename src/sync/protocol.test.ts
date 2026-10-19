import { describe, expect, it } from 'vitest';
import { PARTY_VIEW } from '@/core/model';
import { rebuildPlayerMessage } from './protocol';

const message = (payload: object) => JSON.stringify({ protocol: 3, from: 'player', payload });

describe('rebuildPlayerMessage', () => {
  it("passes a character's chat, notes, shared rolls and edits of its own sheet", () => {
    const payloads = [
      { type: 'chat', text: 'Hello', to: 'all' },
      { type: 'note', text: '# Clues' },
      { type: 'roll', dice: '1d20', mode: 'normal', label: '', share: true },
      { type: 'sheetEdit', combatantId: 'thorin', edit: { field: 'currency', coin: 'gp', value: 12 } },
      { type: 'sheetEdit', combatantId: 'thorin', edit: { field: 'deathSaves', successes: 1, failures: 2 } },
    ];
    for (const payload of payloads) {
      expect(rebuildPlayerMessage(message(payload), 'thorin')).toBe(message(payload));
    }
  });

  it("refuses the party view's chat and notes and edits of another character's sheet", () => {
    const hp = { field: 'hp', value: 3 };
    const refused: [object, string][] = [
      [{ type: 'chat', text: 'Hi', to: 'all' }, PARTY_VIEW],
      [{ type: 'note', text: 'x' }, PARTY_VIEW],
      [{ type: 'sheetEdit', combatantId: PARTY_VIEW, edit: hp }, PARTY_VIEW],
      [{ type: 'sheetEdit', combatantId: 'elara', edit: hp }, 'thorin'],
      [{ type: 'sheetEdit', combatantId: 'thorin', edit: { ...hp, extra: 1 } }, 'thorin'],
      [{ type: 'sheetEdit', combatantId: 'thorin', edit: { field: 'hp', value: -1 } }, 'thorin'],
      [{ type: 'sheetEdit', combatantId: 'thorin', edit: { field: 'slotsUsed', level: 10, value: 1 } }, 'thorin'],
      [{ type: 'chat', text: '', to: 'all' }, 'thorin'],
      [{ type: 'chat', text: 'x'.repeat(501), to: 'all' }, 'thorin'],
      [{ type: 'chat', text: 'Hi', to: 'elara' }, 'thorin'],
      [{ type: 'note', text: 'x'.repeat(20_001) }, 'thorin'],
    ];
    for (const [payload, view] of refused) {
      expect(rebuildPlayerMessage(message(payload), view)).toBeNull();
    }
  });
});
