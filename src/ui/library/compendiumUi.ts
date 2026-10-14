import { create } from 'zustand';
import type { DocRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';

/** Where creature pictures come from: a folder on disk or the D&D 5e API. */
export type PortraitSource = { kind: 'folder'; folder: string } | { kind: 'api' };

/** Dialogs reachable from every page; `CompendiumDialogHost` renders them. */
export type CompendiumDialog =
  | { kind: 'creature-import'; text: string }
  | { kind: 'new-encounter'; campaignId: string | null; map: DocRef | null }
  | { kind: 'attach-portraits'; source: PortraitSource; files: string[] }
  | { kind: 'aurora-import' }
  | { kind: 'dnd5e-api-import' };

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

/**
 * Import from Aurora Builder (Settings > Content, Compendium Creatures/Players/Items/Spells, campaign Party tab,
 * Add combatants > Player character).
 */
export function openAuroraImport(): void {
  useCompendiumDialogStore.setState({ dialog: { kind: 'aurora-import' } });
}

/** Monsters, monster pictures, spells, magic items and equipment from the D&D 5e API into their own pack. */
export function openDndApiImport(): void {
  useCompendiumDialogStore.setState({ dialog: { kind: 'dnd5e-api-import' } });
}
