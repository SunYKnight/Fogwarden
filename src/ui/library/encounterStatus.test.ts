import { describe, expect, it } from 'vitest';
import { createEncounter, freshCombatState, newId, nowIso, type Combatant, type Encounter } from '@/core/model';
import { COMBAT_ENDED_TEXT, encounterStatus, statusLabel } from './encounterStatus';

function combatant(side: Combatant['side'], hp: number): Combatant {
  return {
    id: newId(),
    creature: null,
    name: side,
    side,
    size: 'medium',
    armorClass: 10,
    hp: { current: hp, max: 10, temp: 0 },
    initiative: null,
    conditions: [],
    position: null,
    facingDeg: 0,
    senses: {},
    visionSource: false,
    hiddenFromPlayers: false,
    token: null,
    notes: '',
    ...freshCombatState(null),
  };
}

function encounter(patch: Partial<Encounter>): Encounter {
  return { ...createEncounter('Test', newId(), null), ...patch };
}

describe('encounterStatus', () => {
  it('is not started before the first round', () => {
    expect(statusLabel(encounterStatus(encounter({ combatants: [combatant('enemy', 5)] })))).toBe('Not started');
  });

  it('reports the running round', () => {
    expect(encounterStatus(encounter({ round: 3 }))).toEqual({ kind: 'running', round: 3 });
  });

  it('is finished when every enemy is down', () => {
    const combatants = [combatant('enemy', 0), combatant('enemy', -2), combatant('player', 7)];
    expect(encounterStatus(encounter({ round: 2, combatants })).kind).toBe('finished');
  });

  it('is finished after the DM ended combat', () => {
    const log = [{ id: newId(), at: nowIso(), kind: 'turn' as const, text: COMBAT_ENDED_TEXT }];
    expect(encounterStatus(encounter({ log }))).toEqual({ kind: 'finished', rounds: null });
  });

  it('stays finished when rolls follow the closing line, with the rounds fought', () => {
    const line = (kind: 'turn' | 'roll', text: string) => ({ id: newId(), at: nowIso(), kind, text });
    const log = [
      line('turn', 'Round 1: Goblin'),
      line('turn', 'Round 2: Goblin'),
      line('turn', COMBAT_ENDED_TEXT),
      line('roll', 'd20 12'),
    ];
    const status = encounterStatus(encounter({ log }));
    expect(status).toEqual({ kind: 'finished', rounds: 2 });
    expect(statusLabel(status)).toBe('Ended · 2 rounds');
    expect(statusLabel({ kind: 'finished', rounds: 1 })).toBe('Ended · 1 round');
  });

  it('needs at least one enemy to count as defeated', () => {
    expect(encounterStatus(encounter({ combatants: [combatant('player', 0)] })).kind).toBe('not-started');
  });
});
