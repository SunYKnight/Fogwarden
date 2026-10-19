import { describe, expect, it } from 'vitest';
import type { SheetEdit } from '@/core/model';
import { addWaitingEdit, settleWaitingEdit, waitingEdit, type WaitingEdits } from './waitingEdits';

/** What a stepper does on one click: start from the shown value, ask for one less. */
function stepDown(waiting: WaitingEdits, confirmed: Extract<SheetEdit, { value: number }>): WaitingEdits {
  const shown = (waitingEdit(waiting, confirmed) ?? confirmed).value;
  return addWaitingEdit(waiting, { ...confirmed, value: shown - 1 }, confirmed);
}

describe('waiting sheet edits', () => {
  it('lets steps add up while the DM has not answered, per value', () => {
    const hp = { field: 'hp', value: 28 } as const;
    const slots = { field: 'slotsUsed', level: 1, value: 2 } as const;
    let waiting: WaitingEdits = {};
    for (let click = 0; click < 5; click++) {
      waiting = stepDown(waiting, hp);
    }
    waiting = stepDown(waiting, slots);
    expect(waitingEdit(waiting, hp)).toEqual({ field: 'hp', value: 23 });
    expect(waitingEdit(waiting, slots)).toEqual({ field: 'slotsUsed', level: 1, value: 1 });
    expect(waitingEdit(waiting, { field: 'slotsUsed', level: 2, value: 2 })).toBeNull();
    expect(waitingEdit(waiting, { field: 'tempHp', value: 0 })).toBeNull();
  });

  it("gives way to the DM's value: a changed sheet or an answer for good", () => {
    const hp = { field: 'hp', value: 28 } as const;
    const waiting = addWaitingEdit({}, { field: 'hp', value: 23 }, hp);
    // The DM accepted or changed it: the sheet no longer shows what the player saw.
    expect(waitingEdit(waiting, { field: 'hp', value: 23 })).toBeNull();
    expect(waitingEdit(waiting, { field: 'hp', value: 20 })).toBeNull();
    // Declined or refused: the sheet still shows the old value.
    expect(waitingEdit(settleWaitingEdit(waiting, { field: 'hp', value: 23 }), hp)).toBeNull();
    const saves = { field: 'deathSaves', successes: 0, failures: 1 } as const;
    const both = addWaitingEdit(waiting, { ...saves, successes: 1 }, saves);
    expect(waitingEdit(settleWaitingEdit(both, hp), saves)).toEqual({ ...saves, successes: 1 });
  });
});
