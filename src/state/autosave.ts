import { useAppStore } from './appStore';
import { useEditorStore } from './editorStore';
import { useEncounterStore } from './encounterStore';
import { useLibraryStore } from './libraryStore';

const DELAY_MS = 800;

/** Saves pending map edits now, e.g. before leaving the editor. */
export async function flushMap(): Promise<void> {
  const editor = useEditorStore.getState();
  const revision = editor.revision;
  if (editor.map && revision !== editor.savedRevision) {
    await useAppStore.getState().repository.save('map', editor.snapshot());
    useEditorStore.getState().markSaved(revision);
    await useLibraryStore.getState().refresh('map');
  }
}

/** Saves pending encounter changes now. */
export async function flushEncounter(): Promise<void> {
  const state = useEncounterStore.getState();
  const revision = state.revision;
  if (state.encounter && revision !== state.savedRevision) {
    await useAppStore.getState().repository.saveEncounter(state.encounter);
    useEncounterStore.getState().markSaved(revision);
  }
}

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
