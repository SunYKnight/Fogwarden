import { create } from 'zustand';
import type { PlayerHandout } from './protocol';

export interface ShownHandout {
  handout: PlayerHandout;
  /** View that sees it; null for every view. */
  audience: string | null;
}

/** The handout the DM shows right now; the publisher sends it to its audience and null to every other view. */
export const useHandoutStore = create<{ shown: ShownHandout | null }>(() => ({ shown: null }));
