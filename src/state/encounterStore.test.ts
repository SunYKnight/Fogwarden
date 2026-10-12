import { beforeEach, describe, expect, it } from 'vitest';
import { createEncounter, type Encounter } from '@/core/model';
import { addLog, applyDamage, createPc } from './encounterActions';
import { useEncounterStore } from './encounterStore';

function openFight(): void {
  const encounter: Encounter = createEncounter('Fight', 'campaign', null);
  encounter.combatants = [createPc({ name: 'Thorin', armorClass: 16, maxHp: 30, senses: {}, visionSource: true })];
  useEncounterStore.getState().open(encounter, null);
}

function thorinHp(): number {
  return useEncounterStore.getState().encounter!.combatants[0]!.hp.current;
}

function damageThorin(amount: number): void {
  useEncounterStore.getState().update((d) => {
    d.combatants[0]!.hp = applyDamage(d.combatants[0]!.hp, amount);
    addLog(d, 'damage', `Thorin takes ${amount} damage`);
  }, 'Damage Thorin');
}

describe('encounter undo history', () => {
  beforeEach(openFight);

  it('undoes and redoes a change with its label', () => {
    damageThorin(7);
    expect(thorinHp()).toBe(23);
    expect(useEncounterStore.getState().undo()).toBe('Damage Thorin');
    expect(thorinHp()).toBe(30);
    expect(useEncounterStore.getState().canRedo).toBe(true);
    expect(useEncounterStore.getState().redo()).toBe('Damage Thorin');
    expect(thorinHp()).toBe(23);
  });

  it('keeps log entries, including later ones, when undoing', () => {
    damageThorin(5);
    useEncounterStore.getState().update((d) => addLog(d, 'roll', 'd20: 12'));
    useEncounterStore.getState().undo();
    expect(thorinHp()).toBe(30);
    expect(useEncounterStore.getState().encounter!.log.map((e) => e.text)).toEqual([
      'Thorin takes 5 damage',
      'd20: 12',
    ]);
  });

  it('records no step for log-only and fog-only updates', () => {
    const revision = useEncounterStore.getState().revision;
    useEncounterStore.getState().update((d) => addLog(d, 'note', 'The goblins whisper'));
    useEncounterStore.getState().update((d) => void (d.fog.explored = 'AAAA'));
    expect(useEncounterStore.getState().revision).toBe(revision + 2);
    expect(useEncounterStore.getState().canUndo).toBe(false);
    expect(useEncounterStore.getState().undo()).toBeNull();
    expect(useEncounterStore.getState().encounter!.fog.explored).toBe('AAAA');
  });

  it('keeps only the most recent 40 steps', () => {
    Array.from({ length: 45 }, (_, i) => i).forEach((i) =>
      useEncounterStore.getState().update((d) => void (d.combatants[0]!.initiative = i), 'Set initiative'),
    );
    const labels = Array.from({ length: 41 }, () => useEncounterStore.getState().undo());
    expect(labels.filter((l) => l !== null)).toHaveLength(40);
    expect(labels[40]).toBeNull();
    expect(useEncounterStore.getState().encounter!.combatants[0]!.initiative).toBe(4);
    expect(useEncounterStore.getState().canUndo).toBe(false);
  });

  it('drops the redo branch on a new change', () => {
    damageThorin(4);
    useEncounterStore.getState().undo();
    damageThorin(2);
    expect(useEncounterStore.getState().canRedo).toBe(false);
    expect(useEncounterStore.getState().redo()).toBeNull();
    expect(thorinHp()).toBe(28);
  });

  it('forgets the history when another encounter opens', () => {
    damageThorin(3);
    openFight();
    expect(useEncounterStore.getState().canUndo).toBe(false);
    expect(useEncounterStore.getState().undo()).toBeNull();
  });
});
