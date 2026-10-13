import { useEffect } from 'react';
import type { Encounter } from '@/core/model';
import { useEncounterStore } from '@/state/encounterStore';
import { Tabs, type TabSpec } from '../kit';
import { CombatantPanel } from './CombatantPanel';
import { DiceRoller } from './DiceRoller';
import { useEncounterUi, type InspectorTab } from './encounterUiStore';
import { LogPanel } from './LogPanel';
import { MarkerPanel } from './MarkerPanel';
import { TableTab } from './TableTab';

/** Right column of Play: one tab at a time instead of a stack of panels. */
export function Inspector({ encounter, hasMap }: { encounter: Encounter; hasMap: boolean }) {
  const chosen = useEncounterUi((s) => s.inspectorTab);
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const tab = chosen === 'areas' && !hasMap ? 'creature' : chosen;

  // Selecting a token or a turn change shows who it is, whatever tab was open.
  useEffect(() => {
    if (selectedId) useEncounterUi.setState({ inspectorTab: 'creature' });
  }, [selectedId]);

  // Table sits next to Creature: outside fights it is the most used tab.
  const tabs: TabSpec<InspectorTab>[] = [
    { id: 'creature', label: 'Creature', icon: 'user' },
    { id: 'table', label: 'Table', icon: 'users' },
    { id: 'dice', label: 'Dice', icon: 'dice' },
    { id: 'log', label: 'Log', icon: 'list' },
    { id: 'areas', label: 'Areas', icon: 'area', badge: String(encounter.markers.length) },
  ];

  return (
    <aside className="play-inspector" aria-label="Inspector">
      <Tabs
        tabs={tabs.filter((t) => hasMap || t.id !== 'areas')}
        value={tab}
        onChange={(id) => useEncounterUi.setState({ inspectorTab: id })}
        label="Inspector"
      />
      <div className="inspector-body" role="tabpanel">
        {tab === 'creature' && <CombatantPanel encounter={encounter} />}
        {tab === 'table' && <TableTab encounter={encounter} />}
        {tab === 'dice' && <DiceRoller />}
        {tab === 'log' && <LogPanel encounter={encounter} />}
        {tab === 'areas' && <MarkerPanel encounter={encounter} />}
      </div>
    </aside>
  );
}
