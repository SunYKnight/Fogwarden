import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CampaignLibrary } from './CampaignLibrary';
import { CreatureLibrary } from './CreatureLibrary';
import { MapLibrary } from './MapLibrary';
import { MarkerLibrary } from './MarkerLibrary';

/** Library tabs; modules append their tab (creatures, markers, campaigns) here. */
export const LIBRARY_TABS: { id: string; label: string; Component: ComponentType }[] = [
  { id: 'maps', label: 'Maps', Component: MapLibrary },
  { id: 'creatures', label: 'Creatures', Component: CreatureLibrary },
  { id: 'markers', label: 'Markers', Component: MarkerLibrary },
  { id: 'campaigns', label: 'Campaigns', Component: CampaignLibrary },
];

function ProblemList() {
  const listings = useLibraryStore((s) => s.listings);
  const problems = useMemo(
    () => [...listings.creature.problems, ...listings.marker.problems, ...listings.map.problems],
    [listings],
  );
  return problems.length > 0 ? (
    <div className="panel" style={{ borderColor: 'var(--danger)', marginBottom: 10 }}>
      <h3>Files that could not be loaded</h3>
      {problems.map((p) => (
        <div key={`${p.area}:${p.path}`} className="muted">
          {p.area}:{p.path} — {p.message}
        </div>
      ))}
    </div>
  ) : null;
}

export function LibraryPage() {
  const [tab, setTab] = useState(LIBRARY_TABS[0]!.id);
  const reportError = useAppStore((s) => s.reportError);
  const refreshAll = useLibraryStore((s) => s.refreshAll);
  const active = LIBRARY_TABS.find((t) => t.id === tab) ?? LIBRARY_TABS[0]!;

  useEffect(() => {
    refreshAll().catch(reportError);
  }, [refreshAll, reportError]);

  return (
    <div>
      <div className="tabs">
        {LIBRARY_TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <ProblemList />
      <active.Component />
    </div>
  );
}
