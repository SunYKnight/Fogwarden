import { create } from 'zustand';
import type { MapPoint } from '@/core/model';

/** How long a ping's ring stays on the map. */
const PING_MS = 3000;

export interface Ping {
  id: number;
  at: MapPoint;
  /** Who pointed: "DM" or the character's name. */
  by: string;
  /** View that pointed; null for the DM and on player screens. */
  from: string | null;
  /** `performance.now()` when the ping arrived; the ring animates from here. */
  startedAt: number;
}

interface PingState {
  pings: Ping[];
  add(ping: Pick<Ping, 'at' | 'by' | 'from'>): void;
}

let nextPingId = 1;

/** Pings currently shown on this screen's map; each one removes itself after `PING_MS`. */
export const usePingStore = create<PingState>((set) => ({
  pings: [],
  add: (ping) => {
    const id = nextPingId++;
    set((s) => ({ pings: [...s.pings, { ...ping, id, startedAt: performance.now() }] }));
    setTimeout(() => set((s) => ({ pings: s.pings.filter((p) => p.id !== id) })), PING_MS);
  },
}));
