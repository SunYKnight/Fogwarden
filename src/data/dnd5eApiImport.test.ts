import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_MONSTERS } from '@/core/import/fixtures/dnd5eApiMonsters';
import { DND5E_API } from './dnd5eapiPictures';
import { DND5E_API_PACK, importApiMonsters, planDndApiImport, runDndApiImport, type ApiPart } from './dnd5eApiImport';
import { MemoryStorage } from './memoryStorage';
import { Repository } from './repository';

const SPELL = {
  index: 'light',
  name: 'Light',
  desc: ['You touch one object.'],
  higher_level: [],
  range: 'Touch',
  components: ['V', 'M'],
  material: 'A firefly or phosphorescent moss.',
  ritual: false,
  duration: '1 hour',
  concentration: false,
  casting_time: '1 action',
  level: 0,
  school: { name: 'Evocation' },
  classes: [{ name: 'Wizard' }],
};

const AREA_SPELL = {
  ...SPELL,
  index: 'thunderwave',
  name: 'Thunderwave',
  level: 1,
  damage: [{ damage_type: { index: 'thunder' }, damage_at_slot_level: { 1: '2d8' } }],
  dc: { dc_type: { index: 'con' }, dc_success: 'half' },
  area_of_effect: { type: 'cube', size: 15 },
};

const TORCH = {
  index: 'torch',
  name: 'Torch',
  desc: ['A torch burns for 1 hour.'],
  equipment_category: { name: 'Adventuring Gear' },
  gear_category: { name: 'Standard Gear' },
  cost: { quantity: 1, unit: 'cp' },
  weight: 1,
};

const GOBLIN = FIXTURE_MONSTERS.find((m) => m.index === 'goblin')!;
const WOLF = FIXTURE_MONSTERS.find((m) => m.index === 'wolf')!;

const list = (...entries: { index: string; name: string }[]) => ({ count: entries.length, results: entries });

const RESPONSES: Record<string, unknown> = {
  '/api/2014/monsters': list({ index: 'blob', name: 'Blob' }),
  '/api/2014/monsters/blob': { index: 'blob', name: 'Blob' },
  '/api/2014/monsters/goblin': GOBLIN,
  '/api/2014/monsters/wolf': WOLF,
  '/api/2014/spells': list({ index: 'light', name: 'Light' }, { index: 'thunderwave', name: 'Thunderwave' }),
  '/api/2014/spells/light': SPELL,
  '/api/2014/spells/thunderwave': AREA_SPELL,
  '/api/2014/magic-items': list(),
  '/api/2014/equipment': list({ index: 'torch', name: 'Torch' }),
  '/api/2014/equipment/torch': TORCH,
};

const fakeApi = vi.fn((input: string | URL | Request): Promise<Response> => {
  const body = RESPONSES[String(input).slice(DND5E_API.length)];
  return Promise.resolve(
    body === undefined ? new Response('Not Found', { status: 404 }) : Response.json(body, { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  fakeApi.mockClear();
});

const ROOT = `packs/${DND5E_API_PACK.id}`;

describe('runDndApiImport', () => {
  it('writes the chosen parts into the pack and reports documents it cannot convert', async () => {
    vi.stubGlobal('fetch', fakeApi);
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const plan = await planDndApiImport();
    expect(plan.pictures).toEqual(plan.monsters);
    expect(plan.areas).toEqual(plan.spells);
    fakeApi.mockClear();

    const progress: [ApiPart, number][] = [];
    const parts: ApiPart[] = ['spells', 'equipment', 'areas', 'monsters'];
    const report = await runDndApiImport(
      repository,
      plan,
      parts,
      (part, done) => progress.push([part, done]),
      new AbortController().signal,
    );

    expect(report.written).toEqual({ monsters: 0, pictures: 0, spells: 2, areas: 1, magicItems: 0, equipment: 1 });
    expect(report.problems).toEqual([{ part: 'monsters', name: 'Blob', message: expect.any(String) }]);
    // Spells and their areas share one download.
    expect(fakeApi).toHaveBeenCalledTimes(4);
    expect(progress.filter(([part]) => part === 'areas').map(([, done]) => done)).toEqual([1, 2]);
    expect(progress.at(-1)).toEqual(['equipment', 1]);
    expect([...storage.files.data.keys()].sort()).toEqual([
      `${ROOT}/LICENSE.md`,
      `${ROOT}/items/srd-torch.md`,
      `${ROOT}/markers/srd-thunderwave.json`,
      `${ROOT}/pack.json`,
      `${ROOT}/spells/srd-light.md`,
      `${ROOT}/spells/srd-thunderwave.md`,
    ]);
    const spells = await repository.list('spell');
    expect(spells.entries.find((e) => e.ref.id === 'srd-light')?.doc.components).toBe(
      'V, M (a firefly or phosphorescent moss)',
    );
    const markers = await repository.list('marker');
    expect(markers.entries.map((e) => [e.ref.id, e.pack, e.doc.save?.damage])).toEqual([
      ['srd-thunderwave', DND5E_API_PACK.id, '2d8'],
    ]);
  });

  it('stops once the signal aborts', async () => {
    vi.stubGlobal('fetch', fakeApi);
    const repository = new Repository(new MemoryStorage());
    const plan = await planDndApiImport();
    const abort = new AbortController();
    abort.abort();
    await expect(runDndApiImport(repository, plan, ['spells'], () => undefined, abort.signal)).rejects.toThrow();
  });
});

describe('importApiMonsters', () => {
  it('imports the named monsters the pack lacks and leaves the others alone', async () => {
    vi.stubGlobal('fetch', fakeApi);
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    const progress: [number, number][] = [];

    expect(await importApiMonsters(repository, ['goblin'])).toEqual({ written: 1, problems: [] });
    storage.files.data.set(`${ROOT}/creatures/srd-goblin.txt`, 'edited');
    fakeApi.mockClear();
    const second = await importApiMonsters(repository, ['goblin', 'wolf'], (done, total) =>
      progress.push([done, total]),
    );

    expect(second).toEqual({ written: 1, problems: [] });
    expect(fakeApi).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([[1, 1]]);
    expect(storage.files.data.get(`${ROOT}/creatures/srd-goblin.txt`)).toBe('edited');
    const wolf = await repository.load('creature', { area: 'data', id: 'srd-wolf' });
    expect([wolf.name, wolf.challenge]).toEqual(['Wolf', 0.25]);
  });

  it('writes nothing when the pack has every monster', async () => {
    vi.stubGlobal('fetch', fakeApi);
    const storage = new MemoryStorage();
    storage.files.data.set(`${ROOT}/creatures/srd-goblin.txt`, 'kept');
    expect(await importApiMonsters(new Repository(storage), ['goblin'])).toEqual({ written: 0, problems: [] });
    expect([...storage.files.data.keys()]).toEqual([`${ROOT}/creatures/srd-goblin.txt`]);
    expect(fakeApi).not.toHaveBeenCalled();
  });
});
