import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { DocRef, Settings } from '@/core/model';
import { BrowserStorage } from '@/data/browserStorage';
import { Repository } from '@/data/repository';
import type { StorageRoots } from '@/data/storage';
import { TauriStorage } from '@/data/tauriStorage';

export type Route =
  | { page: 'library' }
  | { page: 'map-editor'; map: DocRef }
  | { page: 'settings' }
  | { page: 'encounter'; campaignId: string; encounterId: string };

export interface AppError {
  id: number;
  message: string;
}

interface AppState {
  repository: Repository;
  roots: StorageRoots | null;
  settings: Settings | null;
  route: Route;
  errors: AppError[];
  navigate(route: Route): void;
  reportError(error: unknown): void;
  dismissError(id: number): void;
  setSettings(settings: Settings): Promise<void>;
  init(): Promise<void>;
}

let nextErrorId = 1;

export const useAppStore = create<AppState>((set, get) => ({
  repository: new Repository(isTauri() ? new TauriStorage() : new BrowserStorage()),
  roots: null,
  settings: null,
  route: { page: 'library' },
  errors: [],
  navigate: (route) => set({ route }),
  reportError: (error) => {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    set((s) => ({ errors: [...s.errors, { id: nextErrorId++, message }] }));
  },
  dismissError: (id) => set((s) => ({ errors: s.errors.filter((e) => e.id !== id) })),
  setSettings: async (settings) => {
    set({ settings: await get().repository.saveSettings(settings) });
  },
  init: async () => {
    const repository = get().repository;
    const [roots, settings] = await Promise.all([repository.storage.roots(), repository.loadSettings()]);
    set({ roots, settings });
  },
}));
