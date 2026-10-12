import { useState } from 'react';
import type { LibraryKind } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { LoadProblems } from '../components/LoadProblems';
import { Button, Icon, PageHeader } from '../kit';
import { isImageFile, useFileDrop } from '../library/fileDrop';
import { MapLibrary } from '../library/MapLibrary';
import { openNewMapWizard } from '../library/NewMapWizard';

const KINDS: LibraryKind[] = ['map'];

export function MapsPage() {
  const [filter, setFilter] = useState('');
  const { dragging, handlers } = useFileDrop((files) => {
    const image = files.find(isImageFile);
    if (image) {
      openNewMapWizard(image);
    } else {
      useAppStore.getState().notify('Drop a PNG, JPEG or WebP battlemap image to create a map.', 'info');
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
        <Button icon="plus" label="New map" variant="primary" onClick={() => openNewMapWizard()} />
      </PageHeader>
      <div className="page-body">
        <LoadProblems kinds={KINDS} />
        <MapLibrary filter={filter} />
      </div>
    </div>
  );
}
