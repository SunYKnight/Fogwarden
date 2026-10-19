import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEncounter, defaultSettings, noPlayerFeatures, PARTY_VIEW, type Encounter } from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import type { useFogViewStore } from '@/render/fog/fogViewStore';
import type { useAppStore } from '@/state/appStore';
import type * as Autosave from '@/state/autosave';
import { addLog, createPc } from '@/state/encounterActions';
import type { useEncounterStore } from '@/state/encounterStore';
import { appendChat, chatLine, chatVisibleTo, DM_NAME } from './chat';
import type * as Mirror from './dmMirror';
import type { useViewLinksStore } from './views';

/** One side's own module instances: the desktop app and the remote DM run in separate windows. */
interface World {
  mirror: typeof Mirror;
  store: typeof useEncounterStore;
  app: typeof useAppStore;
  autosave: typeof Autosave;
  fog: typeof useFogViewStore;
  links: typeof useViewLinksStore;
}

// Dynamic imports after a module reset give each side its own stores; a
// static import would share one set between both.
async function loadWorld(): Promise<World> {
  vi.resetModules();
  const [mirror, store, app, autosave, fogView, repository, views] = await Promise.all([
    import('./dmMirror'),
    import('@/state/encounterStore'),
    import('@/state/appStore'),
    import('@/state/autosave'),
    import('@/render/fog/fogViewStore'),
    import('@/data/repository'),
    import('./views'),
  ]);
  const storage = new MemoryStorage();
  app.useAppStore.setState({ repository: new repository.Repository(storage), settings: defaultSettings() });
  return {
    mirror,
    store: store.useEncounterStore,
    app: app.useAppStore,
    autosave,
    fog: fogView.useFogViewStore,
    links: views.useViewLinksStore,
  };
}

/** One end of an in-memory socket; messages wait in `outbox` until `settle` delivers them. */
class TestChannel implements Mirror.MirrorChannel {
  readonly outbox: string[] = [];
  private readonly handlers = new Set<(text: string) => void>();
  private readonly connection = new Set<(open: boolean) => void>();
  private open = false;

  send(text: string): void {
    if (this.open) this.outbox.push(text);
  }

  onText(handler: (text: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  watchConnection(handler: (open: boolean) => void): () => void {
    this.connection.add(handler);
    handler(this.open);
    return () => this.connection.delete(handler);
  }

  connect(): void {
    this.open = true;
    for (const handler of this.connection) {
      handler(true);
    }
  }

  receive(text: string): void {
    for (const handler of this.handlers) {
      handler(text);
    }
  }
}

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) {
    stop();
  }
  vi.unstubAllGlobals();
  vi.doUnmock('@/sync/fogTracker');
  vi.doUnmock('@/sync/dmPublisher');
  vi.doUnmock('@/sync/atmospherePublisher');
  vi.doUnmock('@/state/journalRecorder');
  vi.doUnmock('@/sound/dmSound');
});

function fight(): Encounter {
  const encounter = createEncounter('Ambush', 'c1', null);
  encounter.combatants = [createPc({ name: 'Thorin', armorClass: 16, maxHp: 30, senses: {}, visionSource: true })];
  return encounter;
}

/** The desktop app with an encounter open and a remote DM connected to it, both caught up. */
async function connected() {
  const desktop = await loadWorld();
  const laptop = await loadWorld();
  desktop.store.getState().open(fight(), null);
  const desktopEnd = new TestChannel();
  const laptopEnd = new TestChannel();
  stops.push(desktop.mirror.startDmMirrorPublisher(desktopEnd, { changeMap: vi.fn() }));
  stops.push(laptop.mirror.startDmMirrorClient(laptopEnd));
  // Everything the desktop sent, to check what never leaves it.
  const delivered: string[] = [];
  const settle = () => {
    while (desktopEnd.outbox.length + laptopEnd.outbox.length > 0) {
      for (const text of desktopEnd.outbox.splice(0)) {
        delivered.push(text);
        laptopEnd.receive(text);
      }
      for (const text of laptopEnd.outbox.splice(0)) desktopEnd.receive(text);
    }
  };
  desktopEnd.connect();
  laptopEnd.connect();
  settle();
  return { desktop, laptop, settle, delivered };
}

const encounterOf = (world: World) => world.store.getState().encounter!;

describe('remote DM mirror', () => {
  it('sends a remote change through the desktop update and its undo history back', async () => {
    const { desktop, laptop, settle } = await connected();
    expect(encounterOf(laptop)).toEqual(encounterOf(desktop));

    laptop.store.getState().update((d) => void (d.combatants[0]!.name = 'Thorin II'), 'Rename');
    // Shown at once, before the desktop answers.
    expect(encounterOf(laptop).combatants[0]!.name).toBe('Thorin II');
    settle();
    expect(encounterOf(desktop).combatants[0]!.name).toBe('Thorin II');
    expect(encounterOf(laptop)).toEqual(encounterOf(desktop));
    expect(desktop.store.getState().canUndo).toBe(true);
    expect(laptop.store.getState().canUndo).toBe(true);

    expect(laptop.store.getState().undo()).toBeNull();
    settle();
    expect(encounterOf(desktop).combatants[0]!.name).toBe('Thorin');
    expect(encounterOf(laptop)).toEqual(encounterOf(desktop));
    expect(laptop.store.getState().canRedo).toBe(true);

    desktop.fog
      .getState()
      .setFog({ size: { cellsX: 2, cellsY: 1, cellFt: 2.5 }, cells: Uint8Array.of(0, 255) }, null, 3);
    settle();
    expect(laptop.fog.getState()).toMatchObject({
      fog: { size: { cellsX: 2, cellsY: 1, cellFt: 2.5 }, cells: Uint8Array.of(0, 255) },
      computeMs: 3,
    });
  });

  it('refuses a change made on a state the desktop changed meanwhile and resends the encounter', async () => {
    const { desktop, laptop, settle } = await connected();
    laptop.store.getState().update((d) => void (d.combatants[0]!.name = 'Thorin II'), 'Rename');
    desktop.store.getState().update((d) => void (d.round = 2), 'Next round');
    settle();
    expect(encounterOf(desktop)).toMatchObject({ round: 2, combatants: [{ name: 'Thorin' }] });
    expect(encounterOf(laptop)).toEqual(encounterOf(desktop));
    expect(laptop.app.getState().notices.map((n) => n.kind)).toEqual(['info']);
  });

  it('applies log, chat and fog changes even after a desktop change, appending log lines', async () => {
    const { desktop, laptop, settle } = await connected();
    laptop.store.getState().update((d) => addLog(d, 'note', 'From the laptop'));
    laptop.store.getState().update((d) => void (d.fog.revealedByDm = 'AQ=='));
    desktop.store.getState().update((d) => {
      d.round = 2;
      addLog(d, 'note', 'From the desktop');
    }, 'Next round');
    settle();
    const desktopLog = encounterOf(desktop).log.map((entry) => entry.text);
    expect(desktopLog.slice(-2)).toEqual(['From the desktop', 'From the laptop']);
    expect(encounterOf(desktop).fog.revealedByDm).toBe('AQ==');
    expect(encounterOf(laptop)).toEqual(encounterOf(desktop));
    expect(laptop.app.getState().notices).toEqual([]);
  });

  it("gives the remote DM the desktop's player views without their link tokens, for whispers to one view", async () => {
    const { desktop, laptop, settle, delivered } = await connected();
    const thorin = encounterOf(desktop).combatants[0]!.id;
    const views = [
      { id: PARTY_VIEW, name: 'Party' },
      { id: thorin, name: 'Thorin' },
      { id: 'elara', name: 'Elara' },
    ];
    const features = { ...noPlayerFeatures(), chat: true };
    const tokens = { [PARTY_VIEW]: 'p'.repeat(32), [thorin]: 't'.repeat(32), elara: 'e'.repeat(32) };
    desktop.links.setState({ views, linked: views, tokens, campaignId: 'c1', features });
    settle();
    expect(laptop.links.getState()).toEqual({ views, linked: views, tokens: {}, campaignId: 'c1', features });
    expect(delivered.some((text) => Object.values(tokens).some((token) => text.includes(token)))).toBe(false);

    // What the laptop's chat panel does for "Send to: Elara".
    laptop.store.getState().update((d) => appendChat(d, chatLine(null, DM_NAME, 'elara', 'say', 'Psst')));
    settle();
    const line = encounterOf(desktop).chat.at(-1)!;
    expect(line).toMatchObject({ from: null, to: 'elara', text: 'Psst' });
    expect(views.filter((v) => chatVisibleTo(line, v.id)).map((v) => v.id)).toEqual(['elara']);
  });

  it('starts no writer as a remote DM: no encounter save, fog tracking, journal or publishing', async () => {
    const starts = {
      fog: vi.fn(),
      publisher: vi.fn(),
      atmosphere: vi.fn(),
      journal: vi.fn(),
      sound: vi.fn(),
    };
    vi.doMock('@/sync/fogTracker', () => ({ startFogTracker: starts.fog }));
    vi.doMock('@/sync/dmPublisher', () => ({ startDmPublisher: starts.publisher }));
    vi.doMock('@/sync/atmospherePublisher', () => ({ startAtmospherePublisher: starts.atmosphere }));
    vi.doMock('@/state/journalRecorder', () => ({ startJournalRecorder: starts.journal }));
    vi.doMock('@/sound/dmSound', () => ({ startDmSound: starts.sound }));
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static readonly OPEN = 1;
      readyState = 0;
      readonly sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;
      constructor(readonly url: string) {
        sockets.push(this);
      }
      send(text: string) {
        this.sent.push(text);
      }
      close() {
        this.readyState = 3;
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('window', { location: { protocol: 'http:' }, setTimeout, clearTimeout });
    const fetch = vi.fn(() => Promise.reject(new Error('no server in this test')));
    vi.stubGlobal('fetch', fetch);

    const laptop = await loadWorld();
    // The laptop world's own instances: `startRemoteDm` checks the class.
    const { RemoteDmStorage } = await import('@/data/remoteDmStorage');
    const { Repository } = await import('@/data/repository');
    const token = 't'.repeat(32);
    laptop.app.setState({ repository: new Repository(new RemoteDmStorage('http://desktop:7717', token)) });
    laptop.mirror.useRemoteDmStore.setState({ host: 'desktop:7717', token });
    stops.push(laptop.mirror.startRemoteDm());
    const stopAutosave = laptop.autosave.startAutosave();

    const socket = sockets[0]!;
    expect(socket.url).toBe(`ws://desktop:7717/ws?token=${token}`);
    socket.readyState = FakeSocket.OPEN;
    socket.onopen!();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'hello', mapKey: null });
    const encounter = fight();
    const frames = [
      { type: 'map', mapKey: 'k:1', map: null },
      {
        type: 'snapshot',
        encounter,
        revision: 4,
        base: 2,
        canUndo: true,
        canRedo: false,
        mapKey: 'k:1',
        rejected: null,
      },
    ];
    for (const frame of frames) {
      socket.onmessage!({ data: JSON.stringify(frame) });
    }
    expect(encounterOf(laptop)).toEqual(encounter);
    expect(laptop.mirror.useRemoteDmStore.getState()).toMatchObject({ connected: true, synced: true });

    laptop.store.getState().update((d) => void (d.round = 3), 'Next round');
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'update', encounterId: encounter.id, base: 2 });
    await laptop.autosave.flushEncounter();
    await stopAutosave();
    expect(fetch).not.toHaveBeenCalled();
    expect(Object.values(starts).every((start) => start.mock.calls.length === 0)).toBe(true);
  });
});
