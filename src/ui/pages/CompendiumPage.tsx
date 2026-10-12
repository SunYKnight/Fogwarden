import { isTauri } from '@tauri-apps/api/core';
import type { LibraryKind } from '@/data/repository';
import { useAppStore, type CompendiumTab } from '@/state/appStore';
import { LoadProblems } from '../components/LoadProblems';
import { Button, PageHeader, Tabs, type TabSpec } from '../kit';
import { attachPortraitsFromFolder } from '../library/AttachPortraitsDialog';
import { openCreatureImport } from '../library/compendiumUi';
import { CreatureLibrary } from '../library/CreatureLibrary';
import { MarkerLibrary } from '../library/MarkerLibrary';

const TABS: TabSpec<CompendiumTab>[] = [
  { id: 'creatures', label: 'Creatures', icon: 'users' },
  { id: 'markers', label: 'Area templates', icon: 'area' },
];

const KINDS: Record<CompendiumTab, LibraryKind[]> = { creatures: ['creature'], markers: ['marker'] };

export function CompendiumPage({ tab }: { tab: CompendiumTab }) {
  const navigate = useAppStore((s) => s.navigate);
  const reportError = useAppStore((s) => s.reportError);
  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Compendium' }]}>
        <Tabs tabs={TABS} value={tab} onChange={(t) => navigate({ page: 'compendium', tab: t })} label="Compendium" />
        {tab === 'creatures' && (
          <>
            <Button icon="upload" label="Import from text" onClick={() => openCreatureImport('')} />
            <Button
              icon="image"
              label="Attach portraits from folder…"
              disabled={!isTauri()}
              title={isTauri() ? 'Match pictures to creatures by name' : 'Needs the desktop app'}
              onClick={() => attachPortraitsFromFolder().catch(reportError)}
            />
            <Button
              icon="plus"
              label="New creature"
              variant="primary"
              onClick={() => navigate({ page: 'creature-editor', ref: null })}
            />
          </>
        )}
      </PageHeader>
      <div className="page-body">
        <LoadProblems kinds={KINDS[tab]} />
        {tab === 'creatures' ? <CreatureLibrary /> : <MarkerLibrary />}
      </div>
    </div>
  );
}
