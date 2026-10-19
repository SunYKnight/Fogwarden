import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitSet } from '@/core/binary';
import { createCreature, createEncounter, createMap, noPlayerFeatures, PARTY_VIEW, type Combatant } from '@/core/model';
import { sheetFromCreature } from '@/core/rules/characterSheet';
import { FOG_VISIBLE, fogSize, viewFog, type FogSources } from '@/core/vision/fog';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { createPc } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { usePingStore } from '@/state/pingStore';
import { appendChat, chatLine, DM_NAME } from './chat';
import { startDmPublisher } from './dmPublisher';
import { resetPlayerData } from './playerData';
import type { DmTransport, PlayerRequest, SyncPayload } from './protocol';
import { useViewLinksStore } from './views';

/** Records what goes to which views; `views` are the ones with receivers. */
class FakeTransport implements DmTransport {
  readonly sent: { views: readonly string[]; payload: SyncPayload }[] = [];
  private resendHandler: (view: string | null, mapRevision?: number) => void = () => undefined;
  private requestHandler: (view: string, request: PlayerRequest) => void = () => undefined;

  constructor(private readonly views: string[]) {}

  send(views: readonly string[], payload: SyncPayload): void {
    const targets = views.filter((view) => this.views.includes(view));
    if (targets.length > 0) {
      this.sent.push({ views: targets, payload });
    }
  }

  onResend(handler: (view: string | null, mapRevision?: number) => void): () => void {
    this.resendHandler = handler;
    return () => undefined;
  }

  onPlayerRequest(handler: (view: string, request: PlayerRequest) => void): () => void {
    this.requestHandler = handler;
    return () => undefined;
  }

  watchViews(handler: (views: ReadonlySet<string>) => void): () => void {
    handler(new Set(this.views));
    return () => undefined;
  }

  hello(view: string, mapRevision?: number): void {
    this.resendHandler(view, mapRevision);
  }

  request(view: string, request: PlayerRequest): void {
    this.requestHandler(view, request);
  }

  lastOf<T extends SyncPayload['type']>(view: string, type: T): Extract<SyncPayload, { type: T }> | undefined {
    const sent = this.sent.filter((s) => s.views.includes(view)).map((s) => s.payload);
    return sent.findLast((p): p is Extract<SyncPayload, { type: T }> => p.type === type);
  }

  encounterOf(view: string): string[] {
    const sent = this.sent.filter((s) => s.views.includes(view)).map((s) => s.payload);
    const last = sent.findLast((p) => p.type === 'encounter');
    return last?.type === 'encounter' ? (last.encounter?.combatants.map((c) => c.name) ?? []) : [];
  }
}

// Four cells in a row: Thorin sees the west half, Elara the east half and
// the goblin.
const at = (x: number) => ({ x, y: 2.5, elevationFt: 0 });
const pc = (name: string, x: number): Combatant => ({
  ...createPc({ name, armorClass: 10, maxHp: 10, senses: {}, visionSource: true }),
  position: at(x),
});
const thorin = pc('Thorin', 2.5);
const elara = pc('Elara', 17.5);
const goblin: Combatant = { ...pc('Goblin', 12.5), side: 'enemy', visionSource: false };

let stop: () => void = () => undefined;

beforeEach(() => {
  const map = createMap({ name: 'm', image: null, squaresX: 4, squaresY: 1, pxPerSquare: 50 });
  const encounter = { ...createEncounter('e', 'c1', null), combatants: [thorin, elara, goblin] };
  useEncounterStore.getState().open(encounter, map);
  const size = fogSize(map.grid, 2);
  const cells = (...seen: number[]) =>
    Uint8Array.from({ length: 16 }, (_, i) => (seen.includes(i % 8) ? FOG_VISIBLE : 0));
  const sources: FogSources = {
    size,
    visible: new Map([
      [thorin.id, cells(0, 1, 2, 3)],
      [elara.id, cells(4, 5, 6, 7)],
    ]),
    explored: new Map(),
    revealed: new BitSet(16),
    hidden: new BitSet(16),
  };
  useFogViewStore.getState().setFog(viewFog(sources, [thorin.id, elara.id]), sources, 1);
  const views = [
    { id: PARTY_VIEW, name: 'Party' },
    { id: thorin.id, name: 'Thorin' },
    { id: elara.id, name: 'Elara' },
  ];
  useViewLinksStore.setState({ views, linked: views });
});

afterEach(() => {
  stop();
  useEncounterStore.getState().close();
  useViewLinksStore.setState({ campaignId: null, features: noPlayerFeatures() });
  resetPlayerData();
});

/** Every chat line text a view got, in order. */
function chatOf(transport: FakeTransport, view: string): string[] {
  return transport.sent
    .filter((s) => s.views.includes(view))
    .flatMap((s) => (s.payload.type === 'chatLines' ? s.payload.lines.map((l) => l.text) : []));
}

describe('player chat and notes', () => {
  const views = () => [PARTY_VIEW, thorin.id, elara.id];

  it('keeps whispers between their view and the DM and gives the party view no chat', () => {
    useViewLinksStore.setState({ features: { ...noPlayerFeatures(), chat: true, sharedRolls: true } });
    const transport = new FakeTransport(views());
    stop = startDmPublisher([transport]);
    transport.request(thorin.id, { type: 'chat', text: 'I pocket the gem', to: 'dm' });
    transport.request(elara.id, { type: 'chat', text: ' Hello all ', to: 'all' });
    useEncounterStore.getState().update((d) => appendChat(d, chatLine(null, DM_NAME, elara.id, 'say', 'Psst')));
    transport.request(thorin.id, { type: 'roll', dice: '1d1', mode: 'normal', label: '', share: true });
    const roll = 'Thorin rolls 1d1: 1 (1d1 [1] = 1)';
    expect(chatOf(transport, thorin.id)).toEqual(['I pocket the gem', 'Hello all', roll]);
    expect(chatOf(transport, elara.id)).toEqual(['Hello all', 'Psst', roll]);
    expect(chatOf(transport, PARTY_VIEW)).toEqual([]);
    expect(transport.lastOf(elara.id, 'chatLines')?.lines[0]).toMatchObject({ by: 'Thorin', kind: 'roll' });

    transport.request(PARTY_VIEW, { type: 'chat', text: 'Party here', to: 'all' });
    transport.hello(PARTY_VIEW);
    transport.hello(elara.id);
    expect(chatOf(transport, PARTY_VIEW)).toEqual([]);
    expect(transport.lastOf(elara.id, 'chatLines')).toMatchObject({ reset: true });
    expect(useEncounterStore.getState().encounter?.chat).toHaveLength(4);
  });

  it('refuses chat and shares no rolls while the campaign has them off', () => {
    const notify = vi.spyOn(useAppStore.getState(), 'notify').mockImplementation(() => undefined);
    const transport = new FakeTransport(views());
    stop = startDmPublisher([transport]);
    transport.request(thorin.id, { type: 'chat', text: 'Hi', to: 'all' });
    transport.request(thorin.id, { type: 'roll', dice: '1d1', mode: 'normal', label: '', share: true });
    expect(useEncounterStore.getState().encounter?.chat).toEqual([]);
    expect(transport.lastOf(thorin.id, 'notice')?.text).toBe('Not done: the campaign has no chat');
    expect(chatOf(transport, elara.id)).toEqual([]);
    notify.mockRestore();
  });

  it("keeps a player's notes for that view alone and none for the party view", async () => {
    useAppStore.setState({ repository: new Repository(new MemoryStorage()) });
    const notify = vi.spyOn(useAppStore.getState(), 'notify').mockImplementation(() => undefined);
    useViewLinksStore.setState({ campaignId: 'c1', features: { ...noPlayerFeatures(), playerNotes: true } });
    const transport = new FakeTransport(views());
    stop = startDmPublisher([transport]);
    transport.request(thorin.id, { type: 'note', text: 'The mayor lies.' });
    transport.request(PARTY_VIEW, { type: 'note', text: 'Party notes' });
    expect(transport.lastOf(thorin.id, 'notes')?.text).toBe('The mayor lies.');
    expect(transport.lastOf(elara.id, 'notes')?.text).not.toBe('The mayor lies.');
    expect(transport.lastOf(PARTY_VIEW, 'notes')).toBeUndefined();
    expect(transport.lastOf(PARTY_VIEW, 'notice')?.text).toBe('Not done: the view keeps no notes');
    const { repository } = useAppStore.getState();
    await vi.waitFor(async () => expect(await repository.loadPlayerNotes('c1', thorin.id)).toBe('The mayor lies.'));
    expect(await repository.loadPlayerNotes('c1', PARTY_VIEW)).toBe('');
    notify.mockRestore();
  });
});

describe('startDmPublisher', () => {
  it('sends each view only what it sees and the shared map once for all of them', () => {
    const transport = new FakeTransport([PARTY_VIEW, thorin.id]);
    stop = startDmPublisher([transport]);
    expect(transport.encounterOf(thorin.id)).toEqual(['Thorin', 'Elara']);
    expect(transport.encounterOf(PARTY_VIEW)).toEqual(['Thorin', 'Elara', 'Goblin']);
    const maps = transport.sent.filter((s) => s.payload.type === 'map');
    expect(maps.map((s) => s.views)).toEqual([[PARTY_VIEW, thorin.id]]);
    const names = transport.sent.filter((s) => s.payload.type === 'view').map((s) => [s.views, s.payload]);
    expect(names).toEqual([
      [[PARTY_VIEW], { type: 'view', name: 'Party', combatantId: null }],
      [[thorin.id], { type: 'view', name: 'Thorin', combatantId: thorin.id }],
    ]);
    // Nobody watches Elara's view, so nothing of it is computed or sent.
    expect(transport.sent.some((s) => s.views.includes(elara.id))).toBe(false);
  });

  it('resends the full state of one view to the transport that asked', () => {
    const asking = new FakeTransport([thorin.id]);
    const other = new FakeTransport([thorin.id]);
    stop = startDmPublisher([asking, other]);
    const before = other.sent.length;
    asking.sent.length = 0;
    asking.hello(thorin.id);
    expect(asking.sent.map((s) => s.payload.type)).toEqual(['map', 'view', 'encounter', 'fog', 'handout', 'camera']);
    expect(asking.sent.every((s) => s.views.length === 1 && s.views[0] === thorin.id)).toBe(true);
    expect(other.sent).toHaveLength(before);
  });

  it('leaves out the map a hello says the player already has', () => {
    const transport = new FakeTransport([thorin.id]);
    stop = startDmPublisher([transport]);
    const revision = transport.lastOf(thorin.id, 'map')!.revision;
    transport.sent.length = 0;
    transport.hello(thorin.id, revision);
    expect(transport.sent.map((s) => s.payload.type)).toEqual(['view', 'encounter', 'fog', 'handout', 'camera']);
    transport.sent.length = 0;
    transport.hello(thorin.id, revision - 1);
    expect(transport.sent[0]?.payload).toMatchObject({ type: 'map', revision });
  });

  it('sends a goblin to a character view once that character sees it', () => {
    const transport = new FakeTransport([thorin.id]);
    stop = startDmPublisher([transport]);
    useEncounterStore.getState().update((d) => {
      d.combatants[2]!.position = at(7.5);
    }, 'Move goblin');
    expect(transport.encounterOf(thorin.id)).toEqual(['Thorin', 'Elara', 'Goblin']);
  });

  it("sends a character's own sheet to that character's view only", () => {
    const transport = new FakeTransport([PARTY_VIEW, thorin.id]);
    stop = startDmPublisher([transport]);
    expect(transport.lastOf(thorin.id, 'encounter')?.encounter?.sheet).toMatchObject({
      name: 'Thorin',
      hp: { current: 10, max: 10, temp: 0 },
      armorClass: 10,
    });
    expect(transport.lastOf(PARTY_VIEW, 'encounter')?.encounter?.sheet).toBeUndefined();
  });

  describe('full sheets', () => {
    const library = useLibraryStore.getState();
    const creature = { ...createCreature('Thorin'), id: 'thorin', kind: 'player' as const };
    const sheet = { ...sheetFromCreature(creature), backstory: 'Swore an oath only Thorin knows.' };
    const sentTo = (transport: FakeTransport, view: string) =>
      JSON.stringify(transport.sent.filter((s) => s.views.includes(view)));

    beforeEach(() => {
      useEncounterStore.getState().update((d) => void (d.combatants[0]!.creature = { area: 'data', id: 'thorin' }));
      const entry = { ref: { area: 'data' as const, id: 'thorin' }, doc: creature, pack: 'library', overrides: [] };
      useLibraryStore.setState({
        listings: { ...library.listings, creature: { ...library.listings.creature, entries: [entry] } },
        characterSheets: { thorin: sheet },
      });
      useViewLinksStore.setState({ features: { ...useViewLinksStore.getState().features, sheets: true } });
    });

    afterEach(() => {
      useLibraryStore.setState({ listings: library.listings, characterSheets: library.characterSheets });
      useViewLinksStore.setState({ features: { ...useViewLinksStore.getState().features, sheets: false } });
    });

    it("go to that character's view only, never to another view or the party", () => {
      const transport = new FakeTransport([PARTY_VIEW, thorin.id, elara.id]);
      stop = startDmPublisher([transport]);
      const details = transport.lastOf(thorin.id, 'encounter')?.encounter?.sheet?.details;
      expect(details?.content?.sheet.backstory).toBe('Swore an oath only Thorin knows.');
      transport.hello(elara.id);
      transport.hello(PARTY_VIEW);
      expect(sentTo(transport, elara.id)).not.toContain('oath');
      expect(sentTo(transport, PARTY_VIEW)).not.toContain('oath');
      expect(transport.lastOf(elara.id, 'encounter')?.encounter?.sheet?.details).toBeUndefined();
      expect(transport.lastOf(PARTY_VIEW, 'encounter')?.encounter?.sheet).toBeUndefined();
    });

    it('send the sheet text once per change and again to a device that says hello', () => {
      const transport = new FakeTransport([thorin.id]);
      stop = startDmPublisher([transport]);
      const first = transport.lastOf(thorin.id, 'encounter')!.encounter!.sheet!.details!;
      useEncounterStore.getState().update((d) => void (d.combatants[0]!.hp.current = 4), 'Hurt Thorin');
      const light = transport.lastOf(thorin.id, 'encounter')!.encounter!.sheet!;
      expect(light.hp.current).toBe(4);
      expect(light.details).toEqual({ revision: first.revision });
      transport.hello(thorin.id);
      expect(transport.lastOf(thorin.id, 'encounter')!.encounter!.sheet!.details).toEqual(first);
      useLibraryStore.setState({ characterSheets: { thorin: { ...sheet, backstory: 'Broke the oath.' } } });
      const changed = transport.lastOf(thorin.id, 'encounter')!.encounter!.sheet!.details!;
      expect(changed.revision).not.toBe(first.revision);
      expect(changed.content?.sheet.backstory).toBe('Broke the oath.');
    });

    it('stay off while the campaign does not share them', () => {
      useViewLinksStore.setState({ features: { ...useViewLinksStore.getState().features, sheets: false } });
      const transport = new FakeTransport([thorin.id]);
      stop = startDmPublisher([transport]);
      expect(transport.lastOf(thorin.id, 'encounter')?.encounter?.sheet).toMatchObject({ name: 'Thorin' });
      expect(transport.lastOf(thorin.id, 'encounter')?.encounter?.sheet?.details).toBeUndefined();
    });
  });

  it('shows a ping to the view that pointed and to the views that see the spot', () => {
    const transport = new FakeTransport([PARTY_VIEW, thorin.id, elara.id]);
    stop = startDmPublisher([transport]);
    usePingStore.getState().add({ at: at(2.5), by: 'DM', from: null });
    transport.request(elara.id, { type: 'point', at: at(7.5) });
    const pings = transport.sent.filter((s) => s.payload.type === 'ping').map((s) => [s.views, s.payload]);
    expect(pings).toEqual([
      [[PARTY_VIEW, thorin.id], { type: 'ping', at: at(2.5), by: 'DM' }],
      [[PARTY_VIEW, thorin.id, elara.id], { type: 'ping', at: at(7.5), by: 'Elara' }],
    ]);
  });

  it("applies a player's move with the grid distance as one undo step once the encounter allows it", () => {
    const transport = new FakeTransport([thorin.id]);
    stop = startDmPublisher([transport]);
    const positionOf = () => useEncounterStore.getState().encounter?.combatants[0]?.position;
    expect(transport.lastOf(thorin.id, 'encounter')?.encounter?.ownMoves).toBeUndefined();
    useEncounterStore.getState().update((d) => void (d.playersMoveTokens = true), 'Allow moves');
    expect(transport.lastOf(thorin.id, 'encounter')?.encounter?.ownMoves).toBe('5-5-5');
    transport.request(thorin.id, { type: 'move', combatantId: thorin.id, to: at(12) });
    expect(positionOf()).toEqual(at(12.5));
    expect(useEncounterStore.getState().encounter?.log.at(-1)?.text).toBe('Thorin moved 10 ft (player)');
    expect(useEncounterStore.getState().undo()).toBe('Move Thorin');
    expect(positionOf()).toEqual(at(2.5));
  });

  it("offers picture uploads only on characters' own views while the campaign allows them", () => {
    useViewLinksStore.setState({ features: noPlayerFeatures() });
    const transport = new FakeTransport([PARTY_VIEW, thorin.id]);
    stop = startDmPublisher([transport]);
    const uploads = (view: string) => transport.lastOf(view, 'encounter')?.encounter?.uploads;
    expect([uploads(thorin.id), uploads(PARTY_VIEW)]).toEqual([undefined, undefined]);
    useViewLinksStore.setState({ features: { ...noPlayerFeatures(), uploads: true } });
    expect([uploads(thorin.id), uploads(PARTY_VIEW)]).toEqual([true, undefined]);
    useViewLinksStore.setState({ features: noPlayerFeatures() });
    expect(uploads(thorin.id)).toBeUndefined();
  });

  it("logs a player's roll and answers that view alone", () => {
    const transport = new FakeTransport([PARTY_VIEW, thorin.id]);
    stop = startDmPublisher([transport]);
    transport.request(thorin.id, { type: 'roll', dice: '1d1+2', mode: 'normal', label: 'Perception' });
    const text = 'Thorin rolls Perception 1d1+2: 3 (1d1 [1] + 2 = 3)';
    expect(useEncounterStore.getState().encounter?.log.at(-1)?.text).toBe(text);
    const answers = transport.sent.filter((s) => s.payload.type === 'rolled');
    expect(answers).toEqual([{ views: [thorin.id], payload: { type: 'rolled', text } }]);
  });

  it("refuses a player's unreadable dice as a notice, not an app error", () => {
    const transport = new FakeTransport([thorin.id]);
    stop = startDmPublisher([transport]);
    const notify = vi.spyOn(useAppStore.getState(), 'notify').mockImplementation(() => undefined);
    const reportError = vi.spyOn(useAppStore.getState(), 'reportError').mockImplementation(() => undefined);
    try {
      transport.request(thorin.id, { type: 'roll', dice: 'd', mode: 'normal', label: '' });
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('Invalid dice expression'), 'info');
      expect(reportError).not.toHaveBeenCalled();
    } finally {
      notify.mockRestore();
      reportError.mockRestore();
    }
  });
});
