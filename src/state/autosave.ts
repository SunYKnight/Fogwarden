import { useAppStore } from './appStore';
import { useEditorStore } from './editorStore';
import { useEncounterStore } from './encounterStore';

const DELAY_MS = 800;

/**
 * `save` as a function whose calls run one after another. Overlapping saves of
 * one document could pair one save's terrain with the other's heightmap scale,
 * or delete a fog mask the newer save just wrote.
 */
function serialized(save: () => Promise<void>): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  return () => {
    const run = queue.then(save);
    // The queue only orders saves; the caller still gets this save's error.
    queue = run.catch(() => undefined);
    return run;
  };
}

/** Saves pending map edits now, e.g. before leaving the editor; resolves after earlier saves. */
export const flushMap = serialized(async () => {
  const editor = useEditorStore.getState();
  const revision = editor.revision;
  if (editor.map && revision !== editor.savedRevision) {
    await useAppStore.getState().repository.save('map', editor.snapshot());
    useEditorStore.getState().markSaved(revision);
  }
});

/** Saves pending encounter changes now; resolves after earlier saves. */
export const flushEncounter = serialized(async () => {
  const state = useEncounterStore.getState();
  const revision = state.revision;
  if (state.encounter && revision !== state.savedRevision) {
    await useAppStore.getState().repository.saveEncounter(state.encounter);
    useEncounterStore.getState().markSaved(revision);
  }
});

/**
 * Saves the open map and encounter a short while after the last change.
 * Returns a function that stops autosaving after flushing pending changes.
 */
export function startAutosave(): () => Promise<void> {
  let mapTimer: number | undefined;
  let encounterTimer: number | undefined;
  const { reportError } = useAppStore.getState();

  const stopEditor = useEditorStore.subscribe((s, prev) => {
    if (s.revision !== prev.revision) {
      window.clearTimeout(mapTimer);
      mapTimer = window.setTimeout(() => flushMap().catch(reportError), DELAY_MS);
    }
  });

  const stopEncounter = useEncounterStore.subscribe((s, prev) => {
    if (s.revision !== prev.revision) {
      window.clearTimeout(encounterTimer);
      encounterTimer = window.setTimeout(() => flushEncounter().catch(reportError), DELAY_MS);
    }
  });

  return async () => {
    stopEditor();
    stopEncounter();
    window.clearTimeout(mapTimer);
    window.clearTimeout(encounterTimer);
    await Promise.all([flushMap(), flushEncounter()]);
  };
}
