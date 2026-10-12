import type { LibraryKind } from '@/data/repository';
import { useAppStore, type CompendiumTab } from '@/state/appStore';
import { LoadProblems } from '../components/LoadProblems';
import { PageHeader, Tabs, type TabSpec } from '../kit';
import { CreatureLibrary } from '../library/CreatureLibrary';
import { MarkerLibrary } from '../library/MarkerLibrary';

const TABS: TabSpec<CompendiumTab>[] = [
  { id: 'creatures', label: 'Creatures', icon: 'users' },
  { id: 'markers', label: 'Area templates', icon: 'area' },
];

const KINDS: Record<CompendiumTab, LibraryKind[]> = { creatures: ['creature'], markers: ['marker'] };

export function CompendiumPage({ tab }: { tab: CompendiumTab }) {
  const navigate = useAppStore((s) => s.navigate);
  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Compendium' }]}>
        <Tabs tabs={TABS} value={tab} onChange={(t) => navigate({ page: 'compendium', tab: t })} label="Compendium" />
      </PageHeader>
      <div className="page-body">
        <LoadProblems kinds={KINDS[tab]} />
        {tab === 'creatures' ? <CreatureLibrary /> : <MarkerLibrary />}
      </div>
    </div>
  );
}
