import { describe, expect, it } from 'vitest';
import { createCreature } from '@/core/model';
import { draftAfterSave } from './draftAfterSave';

describe('draftAfterSave', () => {
  const snapshot = createCreature('Goblin');
  const stored = { ...snapshot, id: 'goblin', updatedAt: '2026-10-14T12:00:00.000Z' };

  it('takes the stored creature when nothing changed during the save', () => {
    expect(draftAfterSave(snapshot, snapshot, stored)).toBe(stored);
  });

  it('keeps edits made during the save under the stored id', () => {
    const edited = { ...snapshot, armorClass: 15 };
    expect(draftAfterSave(edited, snapshot, stored)).toEqual({ ...edited, id: 'goblin' });
  });
});
