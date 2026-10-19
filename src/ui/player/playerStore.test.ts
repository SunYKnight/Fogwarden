import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreature } from '@/core/model';
import { sheetFromCreature } from '@/core/rules/characterSheet';
import type { CharacterDetails, PlayerEncounter, PlayerInterlude, PlayerSheet } from '@/sync/protocol';
import { usePlayerStore } from './playerStore';

const video = { area: 'data', path: 'videos/intro.mp4' } as const;

afterEach(() => {
  vi.useRealTimers();
  usePlayerStore.setState({ interlude: null, encounter: null, details: null, waitingEdits: {}, viewCombatantId: null });
});

describe('usePlayerStore', () => {
  it('keeps a running interlude when a resend repeats it and restarts it when the DM starts it again', () => {
    vi.useFakeTimers();
    const receive = (interlude: PlayerInterlude | null) =>
      usePlayerStore.getState().receive({ type: 'interlude', interlude });
    receive({ id: 1, asset: video, positionSec: 0 });
    const running = usePlayerStore.getState().interlude;
    vi.advanceTimersByTime(5000);
    receive({ id: 1, asset: video, positionSec: 5 });
    expect(usePlayerStore.getState().interlude).toBe(running);

    receive({ id: 2, asset: video, positionSec: 0 });
    expect(usePlayerStore.getState().interlude?.value.id).toBe(2);
    receive(null);
    expect(usePlayerStore.getState().interlude).toBeNull();
  });

  it('keeps the sheet content across messages that carry only its revision', () => {
    const content: CharacterDetails = { sheet: sheetFromCreature(createCreature('Thorin')), spells: {} };
    const sheet: PlayerSheet = {
      id: 'thorin',
      name: 'Thorin',
      hp: { current: 10, max: 10, temp: 0 },
      armorClass: 10,
      speeds: {},
      conditions: [],
      concentrating: false,
      deathSaves: null,
      slots: [],
    };
    const encounter = (details: PlayerSheet['details'], id = 'thorin'): PlayerEncounter => ({
      encounterId: 'e',
      round: 0,
      activeCombatantId: null,
      combatants: [],
      showTurnOrder: false,
      standees: true,
      markers: [],
      openingStates: {},
      sheet: { ...sheet, id, details },
    });
    const receive = (e: PlayerEncounter | null) =>
      usePlayerStore.getState().receive({ type: 'encounter', encounter: e });
    receive(encounter({ revision: 5, content }));
    receive(encounter({ revision: 5 }));
    expect(usePlayerStore.getState().details).toEqual({ id: 'thorin', revision: 5, content });
    // A newer revision without its content, another character or no sheet drop it.
    receive(encounter({ revision: 6 }));
    expect(usePlayerStore.getState().details).toBeNull();
    receive(encounter({ revision: 5, content }));
    receive(encounter({ revision: 5 }, 'elara'));
    expect(usePlayerStore.getState().details).toBeNull();
    receive(encounter({ revision: 5, content }));
    receive(encounter(undefined));
    expect(usePlayerStore.getState().details).toBeNull();
  });

  it('keeps a sheet edit waiting until the DM answers it for good or the view changes character', () => {
    const store = usePlayerStore.getState;
    const hp = { field: 'hp', value: 28 } as const;
    store().receive({ type: 'view', name: 'Thorin', combatantId: 'thorin' });
    store().waitForEdit({ field: 'hp', value: 27 }, hp);
    store().waitForEdit({ field: 'tempHp', value: 3 }, { field: 'tempHp', value: 0 });
    store().receive({ type: 'notice', text: 'Waiting for the DM: Thorin: HP 28 → 27' });
    store().receive({ type: 'view', name: 'Thorin', combatantId: 'thorin' });
    expect(Object.keys(store().waitingEdits)).toEqual(['hp:', 'tempHp:']);

    store().receive({
      type: 'notice',
      text: 'The DM declined: Thorin: HP 28 → 27',
      settles: { field: 'hp', value: 27 },
    });
    expect(Object.keys(store().waitingEdits)).toEqual(['tempHp:']);
    store().receive({ type: 'view', name: 'Elara', combatantId: 'elara' });
    expect(store().waitingEdits).toEqual({});
  });
});
