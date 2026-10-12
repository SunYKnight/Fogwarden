import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, monitorFromPoint, primaryMonitor, type Monitor } from '@tauri-apps/api/window';
import type { WindowOptions } from '@tauri-apps/api/window';
import type { WebviewOptions } from '@tauri-apps/api/webview';
import { create } from 'zustand';
import type { Settings } from '@/core/model';

/** What `new WebviewWindow` accepts: the window places the webview itself. */
type WebviewWindowOptions = Omit<WebviewOptions, 'x' | 'y' | 'width' | 'height'> & WindowOptions;

const PLAYER_LABEL = 'player';
const IDENTIFY_MS = 2500;
const IDENTIFY_SIZE = { width: 420, height: 240 };

interface PlayerWindowState {
  open: boolean;
  /** OS name of the monitor the window is on; null when closed or unknown. */
  monitor: string | null;
}

/** Whether the desktop player window exists and where, for status displays. */
export const usePlayerWindowStore = create<PlayerWindowState>(() => ({ open: false, monitor: null }));

export async function listMonitors(): Promise<Monitor[]> {
  return isTauri() ? availableMonitors() : [];
}

/** Readable monitor name: Windows reports device paths like `\\.\DISPLAY2`. */
export function monitorLabel(name: string | null): string {
  return name ? name.replace(/^\\\\\.\\/, '') : 'Unnamed monitor';
}

function track(window: WebviewWindow, monitor: string | null): void {
  usePlayerWindowStore.setState({ open: true, monitor });
  void window.once('tauri://destroyed', () => usePlayerWindowStore.setState({ open: false, monitor: null }));
}

async function createWindow(label: string, options: WebviewWindowOptions): Promise<WebviewWindow> {
  const created = new WebviewWindow(label, options);
  const { promise, resolve, reject } = Promise.withResolvers<WebviewWindow>();
  void created.once('tauri://created', () => resolve(created));
  void created.once<string>('tauri://error', (e) => reject(new Error(`Window "${label}" failed: ${e.payload}`)));
  return promise;
}

/** Picks up a player window that outlived a reload of the DM window. */
export async function refreshPlayerWindowState(): Promise<void> {
  const existing = isTauri() ? await WebviewWindow.getByLabel(PLAYER_LABEL) : null;
  if (existing) {
    const [position, size] = await Promise.all([existing.outerPosition(), existing.outerSize()]);
    // The centre: a window's outer edge may reach into the neighbouring monitor.
    const monitor = await monitorFromPoint(position.x + size.width / 2, position.y + size.height / 2);
    track(existing, monitor?.name ?? null);
  }
}

async function openDesktopWindow(settings: Settings): Promise<void> {
  const existing = await WebviewWindow.getByLabel(PLAYER_LABEL);
  if (existing) {
    await existing.setFocus();
  } else {
    const monitors = await availableMonitors();
    const chosen = monitors.find((m) => m.name === settings.playerWindow.monitorName);
    const monitor = chosen ?? (await primaryMonitor());
    const position = monitor?.position.toLogical(monitor.scaleFactor);
    const size = monitor?.size.toLogical(monitor.scaleFactor);
    const created = await createWindow(PLAYER_LABEL, {
      url: 'player.html',
      title: 'Fogwarden — Players',
      x: position?.x,
      y: position?.y,
      width: size?.width ?? 1280,
      height: size?.height ?? 800,
      fullscreen: settings.playerWindow.fullscreen,
    });
    track(created, monitor?.name ?? null);
  }
}

/** Opens (or focuses) the player view on the monitor chosen in the settings. */
export async function openPlayerWindow(settings: Settings): Promise<void> {
  if (isTauri()) {
    await openDesktopWindow(settings);
  } else {
    window.open('/player.html', 'fogwarden-player');
  }
}

export async function closePlayerWindow(): Promise<void> {
  const existing = isTauri() ? await WebviewWindow.getByLabel(PLAYER_LABEL) : null;
  await existing?.close();
}

function openIdentifyWindow(monitor: Monitor, index: number): Promise<WebviewWindow> {
  const position = monitor.position.toLogical(monitor.scaleFactor);
  const size = monitor.size.toLogical(monitor.scaleFactor);
  const params = new URLSearchParams({ identify: String(index + 1), name: monitorLabel(monitor.name) });
  return createWindow(`identify-${index}`, {
    url: `player.html?${params}`,
    title: `Monitor ${index + 1}`,
    x: position.x + (size.width - IDENTIFY_SIZE.width) / 2,
    y: position.y + (size.height - IDENTIFY_SIZE.height) / 2,
    ...IDENTIFY_SIZE,
    decorations: false,
    alwaysOnTop: true,
    resizable: false,
    focus: false,
    skipTaskbar: true,
  });
}

/**
 * Shows the number and name of every monitor (numbered in `listMonitors` order) on that monitor for a moment,
 * so the DM can match the settings' monitor map to the real screens.
 */
export async function identifyMonitors(): Promise<void> {
  const windows = await Promise.all((await availableMonitors()).map(openIdentifyWindow));
  const { promise, resolve } = Promise.withResolvers<void>();
  window.setTimeout(resolve, IDENTIFY_MS);
  await promise;
  await Promise.all(windows.map((w) => w.close()));
}
