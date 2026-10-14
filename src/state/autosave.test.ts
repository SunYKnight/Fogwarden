import { describe, expect, it, vi } from 'vitest';
import { createEncounter, type Encounter } from '@/core/model';
import { MemoryStorage } from '@/data/memoryStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from './appStore';
import { flushEncounter } from './autosave';
import { addLog } from './encounterActions';
import { useEncounterStore } from './encounterStore';

/** A repository whose encounter saves finish only when the test says so. */
function heldSaves() {
  const repository = new Repository(new MemoryStorage());
  const started: string[] = [];
  const finish: (() => void)[] = [];
  vi.spyOn(repository, 'saveEncounter').mockImplementation((encounter: Encounter) => {
    started.push(encounter.name);
    const { promise, resolve } = Promise.withResolvers<Encounter>();
    finish.push(() => resolve(encounter));
    return promise;
  });
  useAppStore.setState({ repository });
  return { started, finish };
}

function note(text: string): void {
  useEncounterStore.getState().update((d) => addLog(d, 'note', text));
}

describe('autosave', () => {
  it('starts a save only after the one before it finished', async () => {
    const { started, finish } = heldSaves();
    useEncounterStore.getState().open(createEncounter('Ambush', 'c', null), null);
    note('first');
    const first = flushEncounter();
    await vi.waitFor(() => expect(started).toHaveLength(1));
    note('second');
    const second = flushEncounter();
    await Promise.resolve();
    expect(started).toHaveLength(1);
    finish[0]!();
    await vi.waitFor(() => expect(started).toHaveLength(2));
    finish[1]!();
    await Promise.all([first, second]);
    const state = useEncounterStore.getState();
    expect(state.savedRevision).toBe(state.revision);
  });

  it('never counts edits of the next encounter as saved by a late save of the previous one', async () => {
    const { started, finish } = heldSaves();
    useEncounterStore.getState().open(createEncounter('Ambush', 'c', null), null);
    note('ambush');
    const late = flushEncounter();
    await vi.waitFor(() => expect(started).toEqual(['Ambush']));
    useEncounterStore.getState().open(createEncounter('Siege', 'c', null), null);
    note('siege');
    finish[0]!();
    await late;
    const state = useEncounterStore.getState();
    expect(state.encounter!.name).toBe('Siege');
    expect(state.savedRevision).not.toBe(state.revision);
  });
});
