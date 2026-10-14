import { describe, expect, it } from 'vitest';
import { createCreature, createEncounter, PARTY_VIEW, type Encounter } from '@/core/model';
import { addParty, createPc } from '@/state/encounterActions';
import { RELAY_TOKEN_PATTERN } from './relayApi';
import { linkTable, linkToken, playerViews } from './views';

const SECRET = 'f'.repeat(64);

describe('player links', () => {
  it('derives one stable token per view that names no view and fits the relay', async () => {
    const party = await linkToken(SECRET, PARTY_VIEW, 0);
    expect(await linkToken(SECRET, PARTY_VIEW, 0)).toBe(party);
    expect(party).toMatch(RELAY_TOKEN_PATTERN);
    expect(party).not.toContain(PARTY_VIEW);
    expect(await linkToken(SECRET, 'thorin', 0)).not.toBe(party);
  });

  it('cannot be turned into another view without the secret', async () => {
    const thorin = await linkToken(SECRET, 'thorin', 0);
    // Same view and rotation under another secret: knowing tokens and views
    // tells nothing about a token the DM's secret makes.
    expect(await linkToken('e'.repeat(64), 'thorin', 0)).not.toBe(thorin);
    const elara = await linkToken(SECRET, 'elara', 0);
    const table = linkTable({ views: [{ id: 'thorin', name: 'Thorin' }], tokens: { thorin, elara } });
    expect(table).toEqual({ [thorin]: 'thorin' });
  });

  it('replaces a view token on every rotation', async () => {
    const tokens = await Promise.all([0, 1, 2].map((rotation) => linkToken(SECRET, 'thorin', rotation)));
    expect(new Set(tokens).size).toBe(3);
  });

  it('offers the party and every player character of the encounter', () => {
    const thorin = createPc({ name: 'Thorin', armorClass: 18, maxHp: 28, senses: {}, visionSource: true });
    const goblin = {
      ...createPc({ name: 'Goblin', armorClass: 15, maxHp: 7, senses: {}, visionSource: false }),
      side: 'enemy' as const,
    };
    const encounter = { ...createEncounter('e', 'c1', null), combatants: [thorin, goblin] };
    expect(playerViews(encounter)).toEqual([
      { id: PARTY_VIEW, name: 'Party' },
      { id: thorin.id, name: 'Thorin' },
    ]);
  });

  it("keeps a party member's view and link the same in every encounter of the campaign", async () => {
    const thorin = { ...createCreature('Thorin'), kind: 'player' as const };
    const member = { id: 'm-thorin', creature: { area: 'data', id: thorin.id }, player: 'Anna' } as const;
    const viewsOf = (name: string) => {
      const encounter: Encounter = createEncounter(name, 'c1', null);
      addParty(encounter, [{ member, creature: thorin }]);
      return { combatant: encounter.combatants[0]!, views: playerViews(encounter) };
    };
    const ambush = viewsOf('Ambush');
    const lair = viewsOf('Lair');
    expect(ambush.views).toEqual([
      { id: PARTY_VIEW, name: 'Party' },
      { id: member.id, name: 'Thorin' },
    ]);
    expect(lair.views).toEqual(ambush.views);
    // Fog, moves and sheets find the view's character by combatant id.
    expect(ambush.combatant.id).toBe(member.id);
    expect(lair.combatant.partyMemberId).toBe(member.id);
    expect(await linkToken(SECRET, lair.views[1]!.id, 0)).toBe(await linkToken(SECRET, ambush.views[1]!.id, 0));
  });
});
