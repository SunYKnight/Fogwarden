import { create } from 'zustand';

/** What the DM lets the player view show besides the map; the publisher sends it with the encounter. */
export const usePlayerViewStore = create<{ showTurnOrder: boolean }>(() => ({ showTurnOrder: false }));
