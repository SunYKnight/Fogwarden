import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { DocRef, EncounterLocator, Settings } from '@/core/model';
import { BrowserStorage } from '@/data/browserStorage';
import { migrateDataRoot } from '@/data/layoutMigration';
import { migrateToPacks } from '@/data/packMigration';
import { Repository } from '@/data/repository';
import type { StorageRoots } from '@/data/storage';
import { TauriStorage } from '@/data/tauriStorage';

export type CompendiumTab = 'creatures' | 'markers' | 'tables' | 'packs';

export type Route =
  | { page: 'home' }
  | { page: 'maps' }
  | { page: 'map-editor'; map: DocRef }
  | { page: 'compendium'; tab: CompendiumTab }
  | { page: 'campaigns'; campaignId: string | null }
  | { page: 'play' }
  | { page: 'server' }
  | { page: 'settings' }
  | { page: 'creature-editor'; ref: DocRef | null };

export type NoticeKind = 'error' | 'success' | 'info';

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

interface AppState {
  repository: Repository;
  roots: StorageRoots | null;
  settings: Settings | null;
  route: Route;
  notices: Notice[];
  /** Asked before leaving the page, e.g. to keep unsaved edits; resolves true to leave. */
  leaveGuard: (() => Promise<boolean>) | null;
  navigate(route: Route): void;
  setLeaveGuard(guard: (() => Promise<boolean>) | null): void;
  /** Makes the encounter the one on the Play screen and shows it. */
  openEncounter(locator: EncounterLocator): Promise<void>;
  /** Clears the Play screen when its encounter was deleted (by campaign or by encounter id). */
  forgetEncounter(match: { campaignId: string; encounterId?: string }): Promise<void>;
  reportError(error: unknown): void;
  notify(message: string, kind?: NoticeKind): void;
  dismissNotice(id: number): void;
  setSettings(settings: Settings): Promise<void>;
  init(): Promise<void>;
}

let nextNoticeId = 1;
// Errors stay until dismissed; confirmations fade on their own.
const NOTICE_MS = 4000;
// Settings writes run one after another so the file ends with the last edit.
let settingsWrites: Promise<unknown> = Promise.resolve();

export const useAppStore = create<AppState>((set, get) => ({
  repository: new Repository(isTauri() ? new TauriStorage() : new BrowserStorage()),
  roots: null,
  settings: null,
  route: { page: 'home' },
  notices: [],
  leaveGuard: null,
  navigate: (route) => {
    const guard = get().leaveGuard;
    if (guard) {
      guard().then((ok) => ok && set({ route, leaveGuard: null }), get().reportError);
    } else {
      set({ route });
    }
  },
  setLeaveGuard: (leaveGuard) => set({ leaveGuard }),
  openEncounter: async (locator) => {
    const settings = get().settings;
    if (!settings) {
      throw new Error('Settings are not loaded yet');
    }
    await get().setSettings({ ...settings, lastEncounter: locator });
    set({ route: { page: 'play' } });
  },
  forgetEncounter: async (match) => {
    const settings = get().settings;
    const active = settings?.lastEncounter;
    const hit =
      active &&
      active.campaignId === match.campaignId &&
      (!match.encounterId || active.encounterId === match.encounterId);
    if (settings && hit) {
      await get().setSettings({ ...settings, lastEncounter: null });
    }
  },
  reportError: (error) => {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    set((s) => ({ notices: [...s.notices, { id: nextNoticeId++, kind: 'error', message }] }));
  },
  notify: (message, kind = 'success') => {
    const id = nextNoticeId++;
    set((s) => ({ notices: [...s.notices, { id, kind, message }] }));
    window.setTimeout(() => get().dismissNotice(id), NOTICE_MS);
  },
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  // The store changes before the async save: edits made while a save is
  // pending build on this value instead of the stale one and keep both.
  setSettings: async (settings) => {
    set({ settings });
    const write = settingsWrites.then(() => get().repository.saveSettings(settings));
    // The queue only orders writes; the caller still gets this write's error.
    settingsWrites = write.catch(() => undefined);
    const saved = await write;
    if (get().settings === settings) {
      set({ settings: saved });
    }
  },
  init: async () => {
    const repository = get().repository;
    // Packs move after the layout conversion, which works in the old places.
    const layoutProblems = await migrateDataRoot(repository);
    repository.layoutProblems = [...layoutProblems, ...(await migrateToPacks(repository))];
    const [roots, settings] = await Promise.all([repository.storage.roots(), repository.loadSettings()]);
    set({ roots, settings });
  },
}));
