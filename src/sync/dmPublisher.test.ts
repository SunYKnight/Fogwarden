import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BitSet } from '@/core/binary';
import { createEncounter, createMap, PARTY_VIEW, type Combatant } from '@/core/model';
import { FOG_VISIBLE, fogSize, viewFog, type FogSources } from '@/core/vision/fog';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { createPc } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { startDmPublisher } from './dmPublisher';
import type { DmTransport, SyncPayload } from './protocol';
import { useViewLinksStore } from './views';

/** Records what goes to which views; `views` are the ones with receivers. */
class FakeTransport implements DmTransport {
  readonly sent: { views: readonly string[]; payload: SyncPayload }[] = [];
  private resendHandler: (view: string | null) => void = () => undefined;

  constructor(private readonly views: string[]) {}

  send(views: readonly string[], payload: SyncPayload): void {
    const targets = views.filter((view) => this.views.includes(view));
    if (targets.length > 0) {
      this.sent.push({ views: targets, payload });
    }
  }

  onResend(handler: (view: string | null) => void): () => void {
    this.resendHandler = handler;
    return () => undefined;
  }

  watchViews(handler: (views: ReadonlySet<string>) => void): () => void {
    handler(new Set(this.views));
    return () => undefined;
  }

  hello(view: string): void {
    this.resendHandler(view);
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
  useViewLinksStore.setState({
    views: [
      { id: PARTY_VIEW, name: 'Party' },
      { id: thorin.id, name: 'Thorin' },
      { id: elara.id, name: 'Elara' },
    ],
  });
});

afterEach(() => {
  stop();
  useEncounterStore.getState().close();
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
      [[PARTY_VIEW], { type: 'view', name: 'Party' }],
      [[thorin.id], { type: 'view', name: 'Thorin' }],
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
    expect(asking.sent.map((s) => s.payload.type)).toEqual(['map', 'view', 'encounter', 'fog', 'camera']);
    expect(asking.sent.every((s) => s.views.length === 1 && s.views[0] === thorin.id)).toBe(true);
    expect(other.sent).toHaveLength(before);
  });

  it('sends a goblin to a character view once that character sees it', () => {
    const transport = new FakeTransport([thorin.id]);
    stop = startDmPublisher([transport]);
    useEncounterStore.getState().update((d) => {
      d.combatants[2]!.position = at(7.5);
    }, 'Move goblin');
    expect(transport.encounterOf(thorin.id)).toEqual(['Thorin', 'Elara', 'Goblin']);
  });
});
