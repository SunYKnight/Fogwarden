import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from './appStore';

function change(edit: (settings: Settings) => Settings): Promise<void> {
  const { settings, setSettings } = useAppStore.getState();
  return setSettings(edit(settings!));
}

describe('settings saves', () => {
  it('keeps both edits when the second starts before the first is saved', async () => {
    const storage = new MemoryStorage();
    const repository = new Repository(storage);
    useAppStore.setState({ repository, settings: defaultSettings() });

    const first = change((s) => ({ ...s, remote: { ...s.remote, url: 'https://relay.example.org' } }));
    const second = change((s) => ({ ...s, remote: { ...s.remote, dmKey: 'k'.repeat(32) } }));
    await Promise.all([first, second]);

    const expected = { url: 'https://relay.example.org', dmKey: 'k'.repeat(32) };
    expect(useAppStore.getState().settings!.remote).toMatchObject(expected);
    expect((await repository.loadSettings()).remote).toMatchObject(expected);
  });
});
