import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCreature,
  createEncounter,
  emptyPlayerSheet,
  noPlayerFeatures,
  PARTY_VIEW,
  type Combatant,
  type PlayerFeatures,
  type SheetEdit,
} from '@/core/model';
import { sheetFromCreature } from '@/core/rules/characterSheet';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { createPc } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { onPlayerNotice, resetPlayerData, usePlayerDataStore } from './playerData';
import type { SyncPayload } from './protocol';
import {
  acceptSheetEdit,
  applySheetOverlay,
  checkSheetEdit,
  handleSheetEdit,
  overlayAfter,
  rejectSheetEdit,
  type SheetEditContext,
} from './sheetEdits';
import { useViewLinksStore } from './views';

const pc = (name: string): Combatant => ({
  ...createPc({ name, armorClass: 10, maxHp: 20, senses: {}, visionSource: true }),
  level: 3,
  hp: { current: 12, max: 20, temp: 0 },
});
const thorin = pc('Thorin');
const elara = pc('Elara');
const encounter = { ...createEncounter('e', 'c1', null), combatants: [thorin, elara] };
const mage = createCreature('Thorin');
mage.traits = [{ name: 'Spellcasting', description: '1st level (4 slots): bless, shield' }];
const sheet = {
  ...sheetFromCreature(mage),
  inventory: [{ name: 'Rope', item: null, quantity: 1, equipped: false, attuned: false }],
};
const features: PlayerFeatures = { ...noPlayerFeatures(), sheets: true, sheetEdits: 'auto' };

function context(changes: Partial<SheetEditContext> = {}): SheetEditContext {
  return { encounter, features, creature: mage, sheet, overlay: emptyPlayerSheet(), ...changes };
}

const request = (edit: SheetEdit, combatantId = thorin.id) => ({ type: 'sheetEdit' as const, combatantId, edit });
const refusal = (ctx: SheetEditContext, edit: SheetEdit, view = thorin.id, combatantId = view) => {
  const check = checkSheetEdit(ctx, view, request(edit, combatantId));
  return 'refused' in check ? check.refused : null;
};

describe('checkSheetEdit', () => {
  it('accepts a value in range and describes the change', () => {
    const check = checkSheetEdit(context(), thorin.id, request({ field: 'hp', value: 7 }));
    expect(check).toEqual({ combatant: thorin, text: 'Thorin: HP 12 → 7', before: '12' });
    expect(refusal(context(), { field: 'slotsUsed', level: 1, value: 4 })).toBeNull();
    expect(refusal(context(), { field: 'hitDiceUsed', value: 3 })).toBeNull();
    expect(refusal(context(), { field: 'itemQuantity', index: 0, value: 3 })).toBeNull();
  });

  it('refuses values outside their rule range', () => {
    const ctx = context();
    expect(refusal(ctx, { field: 'hp', value: 21 })).toBe('HP above the maximum of 20');
    expect(refusal(ctx, { field: 'tempHp', value: 1000 })).toBe('temporary HP above 999');
    expect(refusal(ctx, { field: 'slotsUsed', level: 1, value: 5 })).toBe('only 4 level 1 slots');
    expect(refusal(ctx, { field: 'slotsUsed', level: 2, value: 1 })).toBe('the character has no level 2 slots');
    expect(refusal(ctx, { field: 'hitDiceUsed', value: 4 })).toBe('only 3 hit dice');
    expect(refusal(ctx, { field: 'deathSaves', successes: 1, failures: 0 })).toBe('death saves only count at 0 HP');
    expect(refusal(ctx, { field: 'itemEquipped', index: 1, value: true })).toBe('no such item');
    expect(refusal(ctx, { field: 'hp', value: 12 })).toBe('nothing changes');
  });

  it("refuses another character's sheet, the party view and campaigns without sheet edits", () => {
    expect(refusal(context(), { field: 'hp', value: 7 }, thorin.id, elara.id)).toBe(
      'that sheet belongs to another view',
    );
    expect(refusal(context(), { field: 'hp', value: 7 }, elara.id, thorin.id)).toBe(
      'that sheet belongs to another view',
    );
    expect(refusal(context(), { field: 'hp', value: 7 }, PARTY_VIEW)).toBe('the character is not in this encounter');
    const off = context({ features: { ...features, sheetEdits: 'off' } });
    expect(refusal(off, { field: 'hp', value: 7 })).toBe('players may not change their sheets');
  });

  it('changes inventory and coins only with full sheets and a loaded overlay', () => {
    const noSheets = context({ features: { ...features, sheets: false }, sheet: null });
    expect(refusal(noSheets, { field: 'currency', coin: 'gp', value: 5 })).toBe('players do not see their full sheet');
    expect(refusal(context({ overlay: null }), { field: 'currency', coin: 'gp', value: 5 })).toBe(
      'the sheet is still loading',
    );
  });
});

describe('sheet overlay', () => {
  it('merges item changes only while the item keeps its name', () => {
    const overlay = overlayAfter(context(), { field: 'itemQuantity', index: 0, value: 3 })!;
    expect(overlay.inventory).toEqual({ '0': { name: 'Rope', quantity: 3, equipped: false } });
    expect(applySheetOverlay(sheet, overlay).inventory[0]?.quantity).toBe(3);
    const renamed = { ...sheet, inventory: [{ ...sheet.inventory[0]!, name: 'Chain' }] };
    expect(applySheetOverlay(renamed, overlay).inventory[0]?.quantity).toBe(1);
    const coins = overlayAfter(context({ overlay }), { field: 'currency', coin: 'gp', value: 9 })!;
    expect(applySheetOverlay(sheet, coins).currency.gp).toBe(9);
    expect(overlayAfter(context(), { field: 'hp', value: 3 })).toBeNull();
  });
});

describe('handleSheetEdit', () => {
  const notices: { view: string; text: string; settles?: SheetEdit }[] = [];
  const replies: SyncPayload[] = [];
  const reply = (payload: SyncPayload) => replies.push(payload);
  let stopNotices: () => void = () => undefined;
  const hp = () => useEncounterStore.getState().encounter?.combatants.find((c) => c.id === thorin.id)?.hp;

  beforeEach(() => {
    useAppStore.setState({ repository: new Repository(new MemoryStorage()) });
    vi.spyOn(useAppStore.getState(), 'notify').mockImplementation(() => undefined);
    useEncounterStore.getState().open(encounter, null);
    const views = [
      { id: thorin.id, name: 'Thorin' },
      { id: elara.id, name: 'Elara' },
    ];
    useViewLinksStore.setState({ views, linked: views, campaignId: 'c1', features });
    usePlayerDataStore.setState({ campaignId: 'c1', overlays: { [thorin.id]: emptyPlayerSheet() } });
    stopNotices = onPlayerNotice((view, text, settles) => notices.push({ view, text, settles }));
  });

  afterEach(() => {
    stopNotices();
    notices.length = 0;
    replies.length = 0;
    vi.restoreAllMocks();
    resetPlayerData();
    useEncounterStore.getState().close();
    useViewLinksStore.setState({ campaignId: null, features: noPlayerFeatures() });
  });

  it('applies an edit at once as one undo step with a log line', () => {
    handleSheetEdit(thorin.id, request({ field: 'hp', value: 7 }), reply);
    expect(hp()?.current).toBe(7);
    expect(useEncounterStore.getState().encounter?.log.at(-1)?.text).toBe('Thorin: HP 12 → 7 (player)');
    expect(useEncounterStore.getState().undo()).toBe('Thorin: HP 12 → 7');
    expect(hp()?.current).toBe(12);
  });

  it('writes file values to the overlay and its file', async () => {
    handleSheetEdit(thorin.id, request({ field: 'hitDiceUsed', value: 2 }), reply);
    expect(usePlayerDataStore.getState().overlays[thorin.id]?.hitDiceUsed).toBe(2);
    const { repository } = useAppStore.getState();
    await vi.waitFor(async () => expect((await repository.loadPlayerSheet('c1', thorin.id)).hitDiceUsed).toBe(2));
  });

  it('refuses out-of-range values with a notice and changes nothing', () => {
    handleSheetEdit(thorin.id, request({ field: 'hp', value: 99 }), reply);
    expect(hp()?.current).toBe(12);
    const settles = { field: 'hp', value: 99 };
    expect(replies).toEqual([{ type: 'notice', text: 'Not changed: HP above the maximum of 20', settles }]);
  });

  it('queues edits for the DM in approve mode, a newer one replacing the same value', () => {
    useViewLinksStore.setState({ features: { ...features, sheetEdits: 'approve' } });
    handleSheetEdit(thorin.id, request({ field: 'hp', value: 7 }), reply);
    handleSheetEdit(thorin.id, request({ field: 'hp', value: 5 }), reply);
    handleSheetEdit(thorin.id, request({ field: 'tempHp', value: 3 }), reply);
    expect(hp()).toEqual({ current: 12, max: 20, temp: 0 });
    const pending = usePlayerDataStore.getState().pending;
    expect(pending.map((p) => p.text)).toEqual(['Thorin: HP 12 → 5', 'Thorin: temporary HP 0 → 3']);
    expect(replies.at(-1)).toEqual({ type: 'notice', text: 'Waiting for the DM: Thorin: temporary HP 0 → 3' });

    acceptSheetEdit(pending[0]!.id);
    rejectSheetEdit(pending[1]!.id);
    expect(hp()).toEqual({ current: 5, max: 20, temp: 0 });
    expect(usePlayerDataStore.getState().pending).toEqual([]);
    expect(notices).toEqual([
      { view: thorin.id, text: 'The DM accepted: Thorin: HP 12 → 5', settles: { field: 'hp', value: 5 } },
      { view: thorin.id, text: 'The DM declined: Thorin: temporary HP 0 → 3', settles: { field: 'tempHp', value: 3 } },
    ]);
  });

  it('takes a queued edit back when the player asks for the value the character has', () => {
    useViewLinksStore.setState({ features: { ...features, sheetEdits: 'approve' } });
    handleSheetEdit(thorin.id, request({ field: 'hp', value: 11 }), reply);
    handleSheetEdit(thorin.id, request({ field: 'hp', value: 12 }), reply);
    expect(usePlayerDataStore.getState().pending).toEqual([]);
    expect(replies.at(-1)).toEqual({
      type: 'notice',
      text: 'Taken back: Thorin: HP 12 → 11',
      settles: { field: 'hp', value: 12 },
    });
    expect(useAppStore.getState().notify).not.toHaveBeenCalled();
  });

  it('drops an accepted edit whose value the DM changed meanwhile', () => {
    useViewLinksStore.setState({ features: { ...features, sheetEdits: 'approve' } });
    handleSheetEdit(thorin.id, request({ field: 'hp', value: 7 }), reply);
    useEncounterStore.getState().update((d) => {
      d.combatants.find((c) => c.id === thorin.id)!.hp.current = 10;
    });
    acceptSheetEdit(usePlayerDataStore.getState().pending[0]!.id);
    expect(hp()?.current).toBe(10);
    const text = 'Not changed, the DM changed it meanwhile: Thorin: HP 12 → 7';
    expect(notices).toEqual([{ view: thorin.id, text, settles: { field: 'hp', value: 7 } }]);
  });
});
