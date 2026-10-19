import { sheetEditTarget, type SheetEdit } from '@/core/model';

/**
 * Sheet edits sent in 'approve' mode that the DM has not answered for good, by `sheetEditTarget`, each with the
 * value the DM's sheet showed when the player asked. The sheet shows them instead of that value, so the next
 * step starts from what the player asked for: the DM keeps only the newest edit of a value.
 */
export type WaitingEdits = Readonly<Record<string, { edit: SheetEdit; from: string }>>;

// Edits of one target differ only in their values.
function editValue(edit: SheetEdit): string {
  return JSON.stringify(edit.field === 'deathSaves' ? [edit.successes, edit.failures] : edit.value);
}

/** `waiting` with `edit`, asked for while the DM's sheet showed `confirmed` (the same value as an edit). */
export function addWaitingEdit(waiting: WaitingEdits, edit: SheetEdit, confirmed: SheetEdit): WaitingEdits {
  return { ...waiting, [sheetEditTarget(edit)]: { edit, from: editValue(confirmed) } };
}

/** `waiting` without the edit of `settled`'s value: the DM accepted, declined, refused or took it back. */
export function settleWaitingEdit(waiting: WaitingEdits, settled: SheetEdit): WaitingEdits {
  const target = sheetEditTarget(settled);
  return Object.fromEntries(Object.entries(waiting).filter(([key]) => key !== target));
}

/**
 * The waiting edit of `confirmed`'s value, else null. While the DM's sheet shows another value than the one the
 * player saw, the DM's counts: the DM changed it, and accepting the waiting edit would fail.
 */
export function waitingEdit<E extends SheetEdit>(waiting: WaitingEdits, confirmed: E): E | null {
  const entry = waiting[sheetEditTarget(confirmed)];
  // One target means one field, so the waiting edit has the type of `confirmed`.
  return entry && entry.from === editValue(confirmed) ? (entry.edit as E) : null;
}
