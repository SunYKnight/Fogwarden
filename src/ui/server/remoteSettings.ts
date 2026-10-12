import type { RemoteSettings } from '@/core/model';
import { useAppStore } from '@/state/appStore';

/** Mirrors `ServerSetup` in `src-tauri/src/deploy.rs`. */
export type ServerSetup = RemoteSettings['setup'];

/** Saves a change of the relay settings on top of the latest settings, so async steps never undo other edits. */
export function saveRemote(change: (remote: RemoteSettings) => RemoteSettings): Promise<void> {
  const { settings, setSettings } = useAppStore.getState();
  if (!settings) {
    throw new Error('Settings are not loaded yet');
  }
  return setSettings({ ...settings, remote: change(settings.remote) });
}
