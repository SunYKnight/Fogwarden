import { isTauri } from '@tauri-apps/api/core';
import { primaryMonitor, type Monitor } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { listMonitors } from '../playerWindow';

export interface MonitorList {
  /** In OS order; "Identify" numbers them the same way (index + 1). */
  monitors: Monitor[];
  /** Name of the primary monitor, where the player window opens without a choice. */
  primary: string | null;
}

/** Monitors of this computer; empty outside the desktop app. */
export function useMonitors(): MonitorList {
  const reportError = useAppStore((s) => s.reportError);
  const [list, setList] = useState<MonitorList>({ monitors: [], primary: null });
  useEffect(() => {
    Promise.all([listMonitors(), isTauri() ? primaryMonitor() : null])
      .then(([monitors, primary]) => setList({ monitors, primary: primary?.name ?? null }))
      .catch(reportError);
  }, [reportError]);
  return list;
}
