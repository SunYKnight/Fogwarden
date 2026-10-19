import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPlayerSheet } from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import {
  ensurePlayerData,
  queueSheetEdit,
  readPlayerSheet,
  resetPlayerData,
  storePlayerSheet,
  takeSheetEdit,
  updatePlayerSheet,
  usePlayerDataStore,
} from './playerData';

const hp = (id: string, value: number) => ({
  id,
  edit: { field: 'hp', value } as const,
  text: `HP → ${value}`,
  before: '12',
});

describe('player data', () => {
  beforeEach(() => {
    useAppStore.setState({ repository: new Repository(new MemoryStorage()) });
  });

  afterEach(() => resetPlayerData());

  it('keeps the queue of waiting edits in pending.json and loads it again after a restart', async () => {
    const { repository } = useAppStore.getState();
    queueSheetEdit('c1', 'thorin', hp('e1', 7));
    queueSheetEdit('c1', 'thorin', { id: 'e2', edit: { field: 'tempHp', value: 3 }, text: 'temp', before: '0' });
    // A newer edit of the same value replaces the queued one.
    queueSheetEdit('c1', 'thorin', hp('e3', 5));
    await vi.waitFor(async () =>
      expect((await repository.loadPlayerPending('c1', 'thorin')).map((e) => e.id)).toEqual(['e2', 'e3']),
    );

    resetPlayerData();
    expect(usePlayerDataStore.getState().pending).toEqual([]);
    await ensurePlayerData('c1', 'thorin');
    expect(usePlayerDataStore.getState()).toMatchObject({
      campaignId: 'c1',
      pending: [
        { id: 'e2', view: 'thorin' },
        { id: 'e3', view: 'thorin', edit: { field: 'hp', value: 5 } },
      ],
    });

    expect(takeSheetEdit('e2')?.text).toBe('temp');
    expect(takeSheetEdit('e2')).toBeUndefined();
    await vi.waitFor(async () =>
      expect((await repository.loadPlayerPending('c1', 'thorin')).map((e) => e.id)).toEqual(['e3']),
    );
  });

  it('keeps stored edits under one the player sent while the file loaded, unless it replaces them', async () => {
    const { repository } = useAppStore.getState();
    await repository.storePlayerPending('c1', 'thorin', [
      hp('old-hp', 9),
      { id: 'old-gp', edit: { field: 'currency', coin: 'gp', value: 1 }, text: 'gp', before: '0' },
    ]);
    const loaded = ensurePlayerData('c1', 'thorin');
    queueSheetEdit('c1', 'thorin', hp('new-hp', 4));
    await loaded;
    expect(usePlayerDataStore.getState().pending.map((p) => p.id)).toEqual(['old-gp', 'new-hp']);
    await vi.waitFor(async () =>
      expect((await repository.loadPlayerPending('c1', 'thorin')).map((e) => e.id)).toEqual(['old-gp', 'new-hp']),
    );
  });

  it('changes a sheet the store holds in the store and one it does not hold in the file alone', async () => {
    const { repository } = useAppStore.getState();
    await storePlayerSheet('c1', 'thorin', { ...emptyPlayerSheet(), hitDiceUsed: 1 });
    await updatePlayerSheet('c1', 'thorin', (o) => ({ ...o, hitDiceUsed: o.hitDiceUsed + 1 }));
    expect(usePlayerDataStore.getState().overlays.thorin?.hitDiceUsed).toBe(2);
    expect((await repository.loadPlayerSheet('c1', 'thorin')).hitDiceUsed).toBe(2);

    await updatePlayerSheet('c2', 'anna', (o) => ({ ...o, hitDiceUsed: 3 }));
    expect(usePlayerDataStore.getState().campaignId).toBe('c1');
    expect((await readPlayerSheet('c2', 'anna')).hitDiceUsed).toBe(3);
  });
});
