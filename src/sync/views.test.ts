import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCampaign,
  createCreature,
  createEncounter,
  defaultSettings,
  PARTY_VIEW,
  type Encounter,
} from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { addParty, createPc } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { RELAY_TOKEN_PATTERN } from './relayApi';
import { linkTable, linkToken, playerViews, startViewLinks, useViewLinksStore } from './views';

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
    const table = linkTable({ linked: [{ id: 'thorin', name: 'Thorin' }], tokens: { thorin, elara } });
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

describe('startViewLinks', () => {
  beforeEach(() => {
    const settings = defaultSettings();
    useAppStore.setState({
      repository: new Repository(new MemoryStorage()),
      settings: { ...settings, playerLinks: { secret: SECRET, rotations: {} } },
    });
    useViewLinksStore.setState({ views: [], linked: [], tokens: {} });
  });

  afterEach(() => useEncounterStore.getState().close());

  it("keeps a character's link while the character sits out an encounter of the campaign", async () => {
    const thorin = createPc({ name: 'Thorin', armorClass: 18, maxHp: 28, senses: {}, visionSource: true });
    useEncounterStore.getState().open({ ...createEncounter('Ambush', 'c1', null), combatants: [thorin] }, null);
    const stop = startViewLinks();
    try {
      const token = await linkToken(SECRET, thorin.id, 0);
      await vi.waitFor(() => expect(linkTable(useViewLinksStore.getState())[token]).toBe(thorin.id));

      useEncounterStore.getState().open(createEncounter('Lair', 'c1', null), null);
      expect(useViewLinksStore.getState().views).toEqual([{ id: PARTY_VIEW, name: 'Party' }]);
      expect(linkTable(useViewLinksStore.getState())[token]).toBe(thorin.id);

      useEncounterStore.getState().open(createEncounter('Elsewhere', 'c2', null), null);
      await vi.waitFor(() => expect(linkTable(useViewLinksStore.getState())[token]).toBeUndefined());
    } finally {
      stop();
    }
  });

  it("links every member of the open campaign's party, also after a restart and a party edit", async () => {
    const { repository } = useAppStore.getState();
    const member = (id: string, player: string) => ({ id, creature: { area: 'data', id: `c-${id}` }, player }) as const;
    const campaign = { ...createCampaign('Red Hand'), party: [member('anna', 'Anna')] };
    await repository.storeCampaign(campaign);
    useEncounterStore.getState().open(createEncounter('Ambush', campaign.id, null), null);
    const stop = startViewLinks();
    try {
      const anna = await linkToken(SECRET, 'anna', 0);
      await vi.waitFor(() => expect(linkTable(useViewLinksStore.getState())[anna]).toBe('anna'));
      // Without the creature in the library, the player's name stands in.
      expect(useViewLinksStore.getState().linked).toContainEqual({ id: 'anna', name: 'Anna' });
      expect(useViewLinksStore.getState().views).toEqual([{ id: PARTY_VIEW, name: 'Party' }]);

      await repository.saveCampaign({ ...campaign, party: [...campaign.party, member('ben', 'Ben')] });
      useAppStore.setState({ route: { page: 'maps' } });
      const ben = await linkToken(SECRET, 'ben', 0);
      await vi.waitFor(() => expect(linkTable(useViewLinksStore.getState())[ben]).toBe('ben'));
    } finally {
      stop();
    }
  });
});
