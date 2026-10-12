import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, type Monitor } from '@tauri-apps/api/window';
import { create } from 'zustand';
import type { Settings } from '@/core/model';

const PLAYER_LABEL = 'player';

/** Whether the desktop player window exists, for status displays. */
export const usePlayerWindowStore = create<{ open: boolean }>(() => ({ open: false }));

export async function listMonitors(): Promise<Monitor[]> {
  return isTauri() ? availableMonitors() : [];
}

function track(window: WebviewWindow): void {
  usePlayerWindowStore.setState({ open: true });
  void window.once('tauri://destroyed', () => usePlayerWindowStore.setState({ open: false }));
}

/** Picks up a player window that outlived a reload of the DM window. */
export async function refreshPlayerWindowState(): Promise<void> {
  const existing = isTauri() ? await WebviewWindow.getByLabel(PLAYER_LABEL) : null;
  if (existing) {
    track(existing);
  }
}

async function openDesktopWindow(settings: Settings): Promise<void> {
  const existing = await WebviewWindow.getByLabel(PLAYER_LABEL);
  if (existing) {
    await existing.setFocus();
  } else {
    const monitors = await availableMonitors();
    const monitor = monitors.find((m) => m.name === settings.playerWindow.monitorName) ?? null;
    const position = monitor?.position.toLogical(monitor.scaleFactor);
    const size = monitor?.size.toLogical(monitor.scaleFactor);
    const created = new WebviewWindow(PLAYER_LABEL, {
      url: 'player.html',
      title: 'DnD DM Tool — Players',
      x: position?.x,
      y: position?.y,
      width: size?.width ?? 1280,
      height: size?.height ?? 800,
      fullscreen: settings.playerWindow.fullscreen,
    });
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    void created.once('tauri://created', () => resolve());
    void created.once<string>('tauri://error', (e) => reject(new Error(`Player window failed: ${e.payload}`)));
    await promise;
    track(created);
  }
}

/** Opens (or focuses) the player view on the monitor chosen in the settings. */
export async function openPlayerWindow(settings: Settings): Promise<void> {
  if (isTauri()) {
    await openDesktopWindow(settings);
  } else {
    window.open('/player.html', 'dm-tool-player');
  }
}

export async function closePlayerWindow(): Promise<void> {
  const existing = isTauri() ? await WebviewWindow.getByLabel(PLAYER_LABEL) : null;
  await existing?.close();
}
