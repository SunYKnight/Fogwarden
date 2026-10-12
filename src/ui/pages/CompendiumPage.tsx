import { isTauri } from '@tauri-apps/api/core';
import type { ComponentType } from 'react';
import type { LibraryKind } from '@/data/repository';
import { useAppStore, type CompendiumTab } from '@/state/appStore';
import { LoadProblems } from '../components/LoadProblems';
import { Button, PageHeader, Tabs, type TabSpec } from '../kit';
import { attachPortraitsFromFolder } from '../library/AttachPortraitsDialog';
import { openCreatureImport } from '../library/compendiumUi';
import { CreatureLibrary } from '../library/CreatureLibrary';
import { MarkerLibrary } from '../library/MarkerLibrary';
import { PackActions, PackLibrary } from '../library/PackLibrary';
import { TableActions, TableLibrary } from '../library/TableLibrary';

interface CompendiumTabSpec extends TabSpec<CompendiumTab> {
  /** Library kinds whose unreadable files the tab lists above its body. */
  kinds: LibraryKind[];
  Body: ComponentType;
  /** Tab-specific actions, shown after the tab bar. */
  Actions?: ComponentType;
}

function CreatureActions() {
  const navigate = useAppStore((s) => s.navigate);
  const reportError = useAppStore((s) => s.reportError);
  return (
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
  );
}

/** Tabs in display order; a new tab adds its `CompendiumTab` id and one entry here. */
export const COMPENDIUM_TABS: CompendiumTabSpec[] = [
  {
    id: 'creatures',
    label: 'Creatures',
    icon: 'users',
    kinds: ['creature'],
    Body: CreatureLibrary,
    Actions: CreatureActions,
  },
  { id: 'markers', label: 'Area templates', icon: 'area', kinds: ['marker'], Body: MarkerLibrary },
  { id: 'tables', label: 'Tables', icon: 'dice', kinds: ['table'], Body: TableLibrary, Actions: TableActions },
  { id: 'packs', label: 'Packs', icon: 'package', kinds: [], Body: PackLibrary, Actions: PackActions },
];

export function CompendiumPage({ tab }: { tab: CompendiumTab }) {
  const navigate = useAppStore((s) => s.navigate);
  const spec = COMPENDIUM_TABS.find((t) => t.id === tab) ?? COMPENDIUM_TABS[0]!;
  const { Body, Actions } = spec;
  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Compendium' }]} />
      {/* Tabs first and actions after them: switching never moves a tab. */}
      <div className="compendium-bar">
        <Tabs
          tabs={COMPENDIUM_TABS}
          value={spec.id}
          onChange={(t) => navigate({ page: 'compendium', tab: t })}
          label="Compendium"
        />
        {Actions && (
          <div className="compendium-actions">
            <Actions />
          </div>
        )}
      </div>
      <div className="page-body">
        <LoadProblems kinds={spec.kinds} />
        <Body />
      </div>
    </div>
  );
}
