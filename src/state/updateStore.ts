import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import { errorMessage } from '@/core/errors';
import { autoCheckDecision } from '@/core/updates';
import { useAppStore } from './appStore';
import { flushEncounter, flushMap } from './autosave';
import { useEncounterStore } from './encounterStore';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; notes: string }
  /** `percent` is null while the download size is unknown. */
  | { kind: 'installing'; percent: number | null }
  | { kind: 'failed'; message: string };

interface UpdateState {
  status: UpdateStatus;
  /** Asks the release server for a newer version; failures become a `failed` status. */
  check(): Promise<UpdateStatus>;
  /** Saves open work, downloads and installs the found update, then restarts the app. */
  install(): Promise<void>;
}

// The plugin's handle of the found release; install needs this instance.
let pending: Update | null = null;

async function checkRelease(): Promise<UpdateStatus> {
  let status: UpdateStatus;
  try {
    pending = await check();
    status = pending ? { kind: 'available', version: pending.version, notes: pending.body ?? '' } : { kind: 'current' };
  } catch (error) {
    status = {
      kind: 'failed',
      message: `Could not check for updates (offline, or no release published yet): ${errorMessage(error)}`,
    };
  }
  return status;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: { kind: 'idle' },
  check: async () => {
    set({ status: { kind: 'checking' } });
    const status = await checkRelease();
    set({ status });
    return status;
  },
  install: async () => {
    const update = pending;
    if (!update) {
      throw new Error('No update to install; check for updates first');
    }
    set({ status: { kind: 'installing', percent: null } });
    let total = 0;
    let received = 0;
    try {
      // The installer ends this process; nothing unsaved may be left behind.
      await Promise.all([flushMap(), flushEncounter()]);
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            received += event.data.chunkLength;
            set({ status: { kind: 'installing', percent: total > 0 ? Math.round((received / total) * 100) : null } });
            break;
          case 'Finished':
            break;
        }
      });
      await relaunch();
    } catch (error) {
      set({ status: { kind: 'failed', message: `Update not installed: ${errorMessage(error)}` } });
    }
  },
}));

async function autoCheck(): Promise<void> {
  const { settings, setSettings, notify } = useAppStore.getState();
  if (!settings) {
    throw new Error('Settings are not loaded yet');
  }
  await setSettings({ ...settings, updates: { ...settings.updates, lastCheck: new Date().toISOString() } });
  const status = await useUpdateStore.getState().check();
  if (status.kind === 'available') {
    notify(`Fogwarden ${status.version} is available: Settings > About`, 'info');
  } else if (status.kind === 'failed') {
    notify(status.message, 'error');
  }
}

/**
 * Runs the automatic release check once per app start when the settings allow it, but only after combat in
 * Play has ended, so a found update is a small notice instead of an interruption. Desktop only.
 */
export function startAutoUpdateCheck(): () => void {
  let decided = false;
  const consider = () => {
    const { settings, route, reportError } = useAppStore.getState();
    const playing = route.page === 'play' && (useEncounterStore.getState().encounter?.round ?? 0) > 0;
    const decision = settings && !decided ? autoCheckDecision(settings.updates, new Date(), playing) : 'wait';
    if (decision !== 'wait') {
      decided = true;
    }
    if (decision === 'check') {
      autoCheck().catch(reportError);
    }
  };
  const stopApp = useAppStore.subscribe(consider);
  const stopEncounter = useEncounterStore.subscribe(consider);
  consider();
  return () => {
    stopApp();
    stopEncounter();
  };
}
