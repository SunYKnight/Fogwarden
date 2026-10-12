import { describe, expect, it } from 'vitest';
import { createEncounter, type Encounter } from '../model';
import {
  appendTimeline,
  currentSession,
  formatJournalFile,
  newJournalEntry,
  notableEvents,
  parseJournalFile,
  type JournalEntry,
} from './journal';

function entry(session: number, date: string, createdAt: string | null): JournalEntry {
  return {
    id: `${date}-session-${session}`,
    session,
    title: `Session ${session}`,
    date,
    encounters: [],
    createdAt,
    updatedAt: createdAt,
    body: '',
  };
}

describe('journal files', () => {
  it('round-trips the header and Markdown body', () => {
    const text = [
      '---',
      'title: Session 3',
      'session: 3',
      'date: 2026-10-12',
      'encounters: ambush, cellar',
      'createdAt: 2026-10-12T17:00:00.000Z',
      'updatedAt: 2026-10-12T21:00:00.000Z',
      '---',
      '# The road north',
      '',
      '- met Mirt',
      '',
    ].join('\n');
    const parsed = parseJournalFile(text, '2026-10-12-session-3');
    expect(parsed.encounters).toEqual(['ambush', 'cellar']);
    expect(formatJournalFile(parsed)).toBe(text);
  });

  it('numbers new sessions after the highest one', () => {
    const next = newJournalEntry(
      [entry(2, '2026-10-01', null), entry(5, '2026-10-05', null)],
      new Date(2026, 9, 12, 19),
    );
    expect(next).toMatchObject({ id: '2026-10-12-session-6', session: 6, title: 'Session 6', date: '2026-10-12' });
  });

  it('keeps writing to tonight\u2019s session after midnight, not to last week\u2019s', () => {
    const tonight = entry(3, '2026-10-12', new Date(2026, 9, 12, 19).toISOString());
    const afterMidnight = new Date(2026, 9, 13, 1, 30);
    expect(currentSession([entry(2, '2026-10-05', null), tonight], afterMidnight)?.session).toBe(3);
    expect(currentSession([tonight], new Date(2026, 9, 19, 19))).toBeNull();
  });
});

describe('timeline', () => {
  it('adds a Timeline section at the end when there is none', () => {
    expect(appendTimeline('Notes\n', ['- 20:00 a'])).toBe('Notes\n\n## Timeline\n\n- 20:00 a');
    expect(appendTimeline('', ['- 20:00 a'])).toBe('## Timeline\n\n- 20:00 a');
  });

  it('appends inside the Timeline section, before the next heading', () => {
    const body = '## Timeline\n\n- 20:00 a\n\n\n## Loot\n\nRope';
    expect(appendTimeline(body, ['- 21:00 b'])).toBe('## Timeline\n\n- 20:00 a\n- 21:00 b\n\n## Loot\n\nRope');
  });
});

describe('notable events', () => {
  function fight(): Encounter {
    const encounter = createEncounter('Ambush', 'campaign', null);
    const base = { creature: null, size: 'medium', armorClass: 12, initiative: null, conditions: [], position: null };
    encounter.combatants = [
      { ...base, id: 'g', name: 'Goblin 1', side: 'enemy', hp: { current: 7, max: 7, temp: 0 } },
      { ...base, id: 't', name: 'Thorin', side: 'player', hp: { current: 3, max: 30, temp: 0 } },
    ] as unknown as Encounter['combatants'];
    return encounter;
  }

  it('reports combat start, fallen combatants and the end with its rounds', () => {
    const before = fight();
    const started = { ...before, round: 1 };
    expect(notableEvents(before, started)).toEqual(['Combat started']);

    const hurt = structuredClone(started);
    hurt.round = 3;
    hurt.combatants[0]!.hp.current = 0;
    hurt.combatants[1]!.hp.current = -2;
    expect(notableEvents(started, hurt)).toEqual(['Goblin 1 is defeated', 'Thorin drops to 0 HP']);

    expect(notableEvents(hurt, { ...hurt, round: 0 })).toEqual(['Combat ended after 3 rounds']);
  });

  it('takes XP, loot and death lines from the log but not rolls', () => {
    const before = fight();
    const after = structuredClone(before);
    const at = '2026-10-12T20:00:00.000Z';
    after.log.push(
      { id: '1', at, kind: 'roll', text: 'd20: 12' },
      { id: '2', at, kind: 'xp', text: 'XP: 50 each' },
      { id: '3', at, kind: 'loot', text: 'Loot: 12 gp' },
    );
    expect(notableEvents(before, after)).toEqual(['XP: 50 each', 'Loot: 12 gp']);
  });
});
