import { isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import type { LibraryKind } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { LoadProblems } from '../components/LoadProblems';
import { Button, Icon, PageHeader } from '../kit';
import { DaFolderImportDialog, pickDaFolder, type FolderPlan } from '../library/DaFolderImport';
import { isMapSourceFile, useFileDrop } from '../library/fileDrop';
import { MapLibrary } from '../library/MapLibrary';
import { openNewMapWizard } from '../library/NewMapWizard';

const KINDS: LibraryKind[] = ['map'];

export function MapsPage() {
  const reportError = useAppStore((s) => s.reportError);
  const [filter, setFilter] = useState('');
  const [folderPlan, setFolderPlan] = useState<FolderPlan | null>(null);
  const { dragging, handlers } = useFileDrop((files) => {
    if (files.some(isMapSourceFile)) {
      openNewMapWizard(files);
    } else {
      useAppStore
        .getState()
        .notify('Drop a PNG, JPEG or WebP battlemap or a .dd2vtt, .df2vtt or .uvtt export to create a map.', 'info');
    }
  });
  return (
    <div className={dragging ? 'page-frame page-drop dragging' : 'page-frame page-drop'} {...handlers}>
      <PageHeader crumbs={[{ label: 'Maps' }]}>
        <label className="search-field">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Search name or tag"
            aria-label="Search maps"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        {isTauri() && (
          <Button
            icon="folder"
            label="Import Dungeon Alchemist folder…"
            title="Foundry export of Dungeon Alchemist: one picture and one .json per floor"
            onClick={() => pickDaFolder().then(setFolderPlan, reportError)}
          />
        )}
        <Button icon="plus" label="New map" variant="primary" onClick={() => openNewMapWizard()} />
      </PageHeader>
      <div className="page-body">
        <LoadProblems kinds={KINDS} />
        <MapLibrary filter={filter} />
      </div>
      {folderPlan && <DaFolderImportDialog plan={folderPlan} onClose={() => setFolderPlan(null)} />}
    </div>
  );
}
