import { isTauri } from '@tauri-apps/api/core';
import type { ComponentType } from 'react';
import type { LibraryKind } from '@/data/repository';
import { useAppStore, type CompendiumTab } from '@/state/appStore';
import { LoadProblems } from '../components/LoadProblems';
import { PageHeader, Tabs, type TabSpec } from '../kit';
import { attachPortraitsFromApi, attachPortraitsFromFolder } from '../library/AttachPortraitsDialog';
import { openCreatureImport } from '../library/compendiumUi';
import { CreatureLibrary } from '../library/CreatureLibrary';
import { ItemLibrary, ReferenceActions, SpellLibrary } from '../library/ItemSpellLibrary';
import { MarkerActions, MarkerLibrary } from '../library/MarkerLibrary';
import { SplitButton } from '../library/SplitButton';
import { TableActions, TableLibrary } from '../library/TableLibrary';

interface CompendiumTabSpec extends TabSpec<CompendiumTab> {
  /** Library kinds whose unreadable files the tab lists above its body. */
  kinds: LibraryKind[];
  Body: ComponentType;
  /** Tab-specific actions, shown after the tab bar. */
  Actions: ComponentType;
}

function CreatureActions() {
  const navigate = useAppStore((s) => s.navigate);
  const reportError = useAppStore((s) => s.reportError);
  return (
    <SplitButton
      icon="plus"
      label="New creature"
      variant="primary"
      onClick={() => navigate({ page: 'creature-editor', ref: null })}
      menuLabel="Other ways to add creatures"
      items={[
        { label: 'Import from text', icon: 'upload', run: () => openCreatureImport('') },
        {
          label: isTauri() ? 'Attach portraits from folder…' : 'Attach portraits from folder… (desktop app)',
          icon: 'image',
          disabled: !isTauri(),
          run: () => attachPortraitsFromFolder().catch(reportError),
        },
        {
          label: 'Download pictures from the D&D 5e API…',
          icon: 'download',
          run: () => attachPortraitsFromApi().catch(reportError),
        },
      ]}
    />
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
  { id: 'items', label: 'Items', icon: 'shield', kinds: ['item'], Body: ItemLibrary, Actions: ReferenceActions },
  { id: 'spells', label: 'Spells', icon: 'book', kinds: ['spell'], Body: SpellLibrary, Actions: ReferenceActions },
  {
    id: 'markers',
    label: 'Area templates',
    icon: 'area',
    kinds: ['marker'],
    Body: MarkerLibrary,
    Actions: MarkerActions,
  },
  { id: 'tables', label: 'Tables', icon: 'dice', kinds: ['table'], Body: TableLibrary, Actions: TableActions },
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
        <div className="compendium-actions">
          <Actions />
        </div>
      </div>
      <div className="page-body">
        <LoadProblems kinds={spec.kinds} />
        <Body />
      </div>
    </div>
  );
}
