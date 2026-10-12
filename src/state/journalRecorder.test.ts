import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEncounter } from '@/core/model';
import { CampaignFiles, JOURNAL } from '@/data/campaignFiles';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from './appStore';
import { addLog, applyDamage, createPc } from './encounterActions';
import { useEncounterStore } from './encounterStore';
import { startJournalRecorder } from './journalRecorder';

describe('journal recorder', () => {
  let files: CampaignFiles;
  let stop: () => void;

  beforeEach(() => {
    const storage = new MemoryStorage();
    useAppStore.setState({ repository: new Repository(storage), notices: [] });
    files = new CampaignFiles(storage, 'saltmarsh');
    const encounter = createEncounter('Sea ghost', 'saltmarsh', null);
    encounter.id = 'sea-ghost';
    encounter.combatants = [createPc({ name: 'Thorin', armorClass: 16, maxHp: 10, senses: {}, visionSource: true })];
    useEncounterStore.getState().open(encounter, null);
    stop = startJournalRecorder();
  });

  afterEach(() => stop());

  it('writes notable Play events to a new session entry and links the encounter', async () => {
    const { update } = useEncounterStore.getState();
    update((d) => void (d.round = 1));
    update((d) => {
      d.combatants[0]!.hp = applyDamage(d.combatants[0]!.hp, 12);
      addLog(d, 'damage', 'Thorin takes 12 damage');
    });
    update((d) => addLog(d, 'loot', 'Loot: a silver key'));
    update((d) => addLog(d, 'roll', 'd20: 4'));

    await vi.waitFor(async () => {
      const [entry] = (await files.list(JOURNAL)).docs;
      expect(entry?.body.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
    });
    const [entry] = (await files.list(JOURNAL)).docs;
    expect(entry!.session).toBe(1);
    expect(entry!.encounters).toEqual(['sea-ghost']);
    const lines = entry!.body.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.map((l) => l.replace(/^- \S+ /, ''))).toEqual([
      'Sea ghost: Combat started',
      'Sea ghost: Thorin drops to 0 HP',
      'Sea ghost: Loot: a silver key',
    ]);
    expect(useAppStore.getState().notices.map((n) => n.message)).toContain('Journal: started "Session 1"');
  });

  it('appends to today\u2019s session instead of starting another', async () => {
    const at = new Date();
    const existing = await files.save(JOURNAL, {
      id: 'tonight',
      session: 4,
      title: 'Session 4',
      date: '2000-01-01',
      encounters: [],
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      body: 'We met at the Snapping Line.',
    });
    useEncounterStore.getState().update((d) => void (d.round = 1));

    await vi.waitFor(async () => {
      expect((await files.load(JOURNAL, existing.id)).body).toContain('Combat started');
    });
    const { docs } = await files.list(JOURNAL);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.body).toMatch(/^We met at the Snapping Line\.\n\n## Timeline\n\n- .+ Sea ghost: Combat started$/);
  });
});
