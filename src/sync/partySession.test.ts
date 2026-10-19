import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCampaign, createCreature, createEncounter, emptyPlayerSheet, type Combatant } from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { addParty, createPc, hitDiceAfterLongRest } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import {
  changedSessions,
  longRestParty,
  partySessions,
  SESSION_WRITE_DELAY_MS,
  startPartySessions,
} from './partySession';
import { readPlayerSheet, resetPlayerData, storePlayerSheet } from './playerData';

const creature = {
  ...createCreature('Thorin'),
  id: 'c-thorin',
  kind: 'player' as const,
  level: 6,
  hitPoints: { average: 20, formula: '' },
  traits: [{ name: 'Spellcasting', description: '1st level (4 slots): bless, shield' }],
};
const member = { id: 'thorin', creature: { area: 'data', id: 'c-thorin' }, player: 'Ann' } as const;
const campaign = { ...createCampaign('Saga'), id: 'saga', party: [member] };
const library = useLibraryStore.getState();

const combatant = (id: string): Combatant =>
  useEncounterStore.getState().encounter!.combatants.find((c) => c.id === id)!;

describe('party session state', () => {
  let stop: () => void = () => undefined;
  let storage = new MemoryStorage();

  beforeEach(async () => {
    storage = new MemoryStorage();
    const repository = new Repository(storage);
    useAppStore.setState({ repository });
    await repository.storeCampaign(campaign);
    const entry = { ref: member.creature, doc: creature, pack: 'library', overrides: [] };
    useLibraryStore.setState({
      listings: { ...library.listings, creature: { ...library.listings.creature, entries: [entry] } },
    });
    stop = startPartySessions();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
    useEncounterStore.getState().close();
    useLibraryStore.setState({ listings: library.listings });
    resetPlayerData();
  });

  it('starts a party member in a second encounter with the HP and slots the first left', async () => {
    const first = createEncounter('Ambush', campaign.id, null);
    addParty(first, [{ member, creature }]);
    const guest = createPc({ name: 'Guest', armorClass: 12, maxHp: 10, senses: {}, visionSource: true });
    first.combatants.push(guest);
    useEncounterStore.getState().open(first, null);
    useEncounterStore.getState().update((d) => {
      const thorin = d.combatants.find((c) => c.id === 'thorin')!;
      thorin.hp = { ...thorin.hp, current: 8, temp: 2 };
      thorin.resources.slotsUsed['1'] = 3;
      d.combatants.find((c) => c.id === guest.id)!.hp.current = 1;
    });

    useEncounterStore.getState().open(createEncounter('Lair', campaign.id, null), null);
    const session = { hp: 8, tempHp: 2, slotsUsed: { '1': 3 }, deathSaves: { successes: 0, failures: 0 } };
    const sessions = await partySessions(campaign.id, ['thorin']);
    expect(sessions).toEqual({ thorin: session });
    expect((await useAppStore.getState().repository.loadPlayerSheet(campaign.id, 'thorin')).session).toEqual(session);
    useEncounterStore.getState().update((d) => void addParty(d, [{ member, creature, session: sessions.thorin }]));
    expect(combatant('thorin')).toMatchObject({
      hp: { current: 8, max: 20, temp: 2 },
      resources: { slotsUsed: session.slotsUsed },
    });
    // An ad-hoc character keeps no file.
    expect([...storage.files.data.keys()].filter((path) => path.includes(guest.id))).toEqual([]);
  });

  it('writes a change a moment later, once for several clicks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const encounter = createEncounter('Ambush', campaign.id, null);
    addParty(encounter, [{ member, creature }]);
    useEncounterStore.getState().open(encounter, null);
    for (const current of [15, 12, 9]) {
      useEncounterStore.getState().update((d) => void (d.combatants[0]!.hp.current = current));
    }
    expect((await readPlayerSheet(campaign.id, 'thorin')).session).toBeNull();
    await vi.advanceTimersByTimeAsync(SESSION_WRITE_DELAY_MS);
    expect((await readPlayerSheet(campaign.id, 'thorin')).session?.hp).toBe(9);
  });

  it('restores the party on a long rest, in the files and the open encounter', async () => {
    const { repository } = useAppStore.getState();
    const session = { hp: 0, tempHp: 4, slotsUsed: { '1': 4 }, deathSaves: { successes: 1, failures: 2 } };
    await storePlayerSheet(campaign.id, 'thorin', { ...emptyPlayerSheet(), hitDiceUsed: 5, session });
    const encounter = createEncounter('Camp', campaign.id, null);
    addParty(encounter, [{ member, creature, session }]);
    useEncounterStore.getState().open(encounter, null);

    expect(await longRestParty(campaign.id)).toBe(1);
    expect(combatant('thorin')).toMatchObject({
      hp: { current: 20, max: 20, temp: 0 },
      resources: { slotsUsed: {} },
      deathSaves: { successes: 0, failures: 0 },
    });
    // Level 6 gets 3 of its hit dice back.
    expect(await repository.loadPlayerSheet(campaign.id, 'thorin')).toMatchObject({ hitDiceUsed: 2, session: null });
    expect(useEncounterStore.getState().undo()).toBe('Long rest');
  });

  it('only follows party members', () => {
    const encounter = createEncounter('Ambush', campaign.id, null);
    addParty(encounter, [{ member, creature }]);
    const guest = createPc({ name: 'Guest', armorClass: 12, maxHp: 10, senses: {}, visionSource: true });
    const before = { ...encounter, combatants: [...encounter.combatants, guest] };
    const hurt = (c: Combatant) => ({ ...c, hp: { ...c.hp, current: 1 } });
    expect(changedSessions(before, { ...before, combatants: [before.combatants[0]!, hurt(guest)] })).toEqual([]);
    expect(changedSessions(before, { ...before, combatants: [hurt(before.combatants[0]!), guest] })).toMatchObject([
      { view: 'thorin', session: { hp: 1 } },
    ]);
  });

  it('gives back half the level in hit dice, at least one', () => {
    expect(hitDiceAfterLongRest(5, 6)).toBe(2);
    expect(hitDiceAfterLongRest(1, 1)).toBe(0);
    expect(hitDiceAfterLongRest(4, 3)).toBe(3);
    expect(hitDiceAfterLongRest(4, null)).toBe(0);
  });
});
