import { describe, expect, it } from 'vitest';
import { createEncounter, newId, nowIso, type Combatant, type Encounter } from '@/core/model';
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
    expect(encounterStatus(encounter({ log })).kind).toBe('finished');
  });

  it('needs at least one enemy to count as defeated', () => {
    expect(encounterStatus(encounter({ combatants: [combatant('player', 0)] })).kind).toBe('not-started');
  });
});
