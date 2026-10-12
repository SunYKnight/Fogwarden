import { create } from 'zustand';
import type { DocRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';

/** Dialogs reachable from every page; `CompendiumDialogHost` renders them. */
export type CompendiumDialog =
  | { kind: 'creature-import'; text: string }
  | { kind: 'new-encounter'; campaignId: string | null; map: DocRef | null }
  | { kind: 'attach-portraits'; folder: string; files: string[] };

export const useCompendiumDialogStore = create<{ dialog: CompendiumDialog | null }>(() => ({ dialog: null }));

export function closeCompendiumDialog(): void {
  useCompendiumDialogStore.setState({ dialog: null });
}

/** Shows the creature compendium with the stat block import dialog prefilled. */
export function openCreatureImport(text: string): void {
  useAppStore.getState().navigate({ page: 'compendium', tab: 'creatures' });
  useCompendiumDialogStore.setState({ dialog: { kind: 'creature-import', text } });
}

/** Asks for name, campaign and map, creates the encounter and opens it on the Play page. */
export function openNewEncounter(campaignId: string | null, map: DocRef | null = null): void {
  useCompendiumDialogStore.setState({ dialog: { kind: 'new-encounter', campaignId, map } });
}
