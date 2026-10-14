import type { Encounter } from '@/core/model';
import { Tabs, type TabSpec } from '../kit';
import { DiceRoller } from './DiceRoller';
import { EncounterOverview } from './EncounterOverview';
import { useEncounterUi, type InspectorTab } from './encounterUiStore';
import { LogPanel } from './LogPanel';
import { MarkerPanel } from './MarkerPanel';
import { TableTab } from './TableTab';

/** Right column of Play: the encounter as a whole, one tab at a time; creatures live in the dock. */
export function Inspector({ encounter, hasMap }: { encounter: Encounter; hasMap: boolean }) {
  const chosen = useEncounterUi((s) => s.inspectorTab);
  const tab = chosen === 'areas' && !hasMap ? 'encounter' : chosen;

  // Table sits next to Encounter: outside fights it is the most used tab.
  const tabs: TabSpec<InspectorTab>[] = [
    { id: 'encounter', label: 'Encounter', icon: 'flag' },
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
        {tab === 'encounter' && <EncounterOverview encounter={encounter} />}
        {tab === 'table' && <TableTab encounter={encounter} />}
        {tab === 'dice' && <DiceRoller />}
        {tab === 'log' && <LogPanel encounter={encounter} />}
        {tab === 'areas' && <MarkerPanel encounter={encounter} />}
      </div>
    </aside>
  );
}
