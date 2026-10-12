import type { MouseEvent } from 'react';
import type { DocRef } from '@/core/model';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { AssetImage } from '../components/AssetImage';
import { Button, confirmDialog, EmptyState, Icon, openContextMenu, type MenuItem } from '../kit';
import { openNewEncounter } from './compendiumUi';
import { openNewMapWizard } from './NewMapWizard';

async function duplicateMap(ref: DocRef, name: string): Promise<void> {
  const { repository, notify } = useAppStore.getState();
  const copy = await repository.duplicateMap(ref, `${name} copy`);
  await useLibraryStore.getState().refresh('map');
  notify(`Created "${copy.name}"`);
}

/** Deleting a user copy of a shipped map brings the shipped version back. */
async function deleteMap(entry: LibraryEntry<'map'>): Promise<void> {
  const { name } = entry.doc;
  const ok = await confirmDialog({
    title: entry.overridesContent ? 'Delete edited copy' : 'Delete map',
    message: entry.overridesContent
      ? `Your edits to "${name}" are deleted with their images and models; the shipped version comes back.`
      : `"${name}" is deleted with its images and models. Encounters using it will have no map.`,
    confirmLabel: entry.overridesContent ? 'Delete copy' : 'Delete map',
    danger: true,
  });
  if (ok) {
    const { repository, notify } = useAppStore.getState();
    await repository.remove('map', entry.ref.id);
    await useLibraryStore.getState().refresh('map');
    notify(`Deleted "${name}"`);
  }
}

function MapCard({ entry }: { entry: LibraryEntry<'map'> }) {
  const navigate = useAppStore((s) => s.navigate);
  const reportError = useAppStore((s) => s.reportError);
  const { ref, doc, overridesContent } = entry;
  const shipped = ref.area === 'content';
  const edit = () => navigate({ page: 'map-editor', map: ref });
  const duplicate = () => duplicateMap(ref, doc.name).catch(reportError);
  const remove = () => deleteMap(entry).catch(reportError);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: 'Edit', icon: 'edit', run: edit },
      { label: 'Duplicate', icon: 'copy', run: duplicate },
      { label: 'Use in a new encounter', icon: 'swords', run: () => openNewEncounter(null, ref) },
      { label: 'Delete', icon: 'trash', danger: true, disabled: shipped, run: remove },
    ];
    openContextMenu(e.clientX, e.clientY, items);
  };

  return (
    <div className="card map-card" onContextMenu={onContextMenu}>
      <button type="button" className="map-card-thumb" onClick={edit} aria-label={`Edit ${doc.name}`}>
        <AssetImage asset={doc.image?.asset ?? null} alt={doc.name} />
      </button>
      <div className="body">
        <div className="row">
          <strong className="row-name" title={doc.name}>
            {doc.name}
          </strong>
          {shipped && (
            <span className="badge" title="Shipped with the app; editing creates your copy">
              <Icon name="lock" size={12} /> Shipped
            </span>
          )}
          {overridesContent && (
            <span className="badge data" title="Your copy of a shipped map">
              Edited
            </span>
          )}
        </div>
        <span className="muted">
          {doc.grid.squaresX} × {doc.grid.squaresY} squares
        </span>
        <div className="row">
          <Button icon="edit" label="Edit" onClick={edit} />
          <Button icon="copy" label="Duplicate" onClick={duplicate} />
          <div className="spacer" />
          {!shipped && <Button icon="trash" label="Delete" iconOnly variant="danger" onClick={remove} />}
        </div>
      </div>
    </div>
  );
}

export function MapLibrary({ filter }: { filter: string }) {
  const listing = useLibraryStore((s) => s.listings.map);
  const needle = filter.trim().toLowerCase();
  const entries = listing.entries.filter(
    ({ doc }) => doc.name.toLowerCase().includes(needle) || doc.tags.some((t) => t.toLowerCase().includes(needle)),
  );
  const newMap = <Button icon="plus" label="New map" variant="primary" onClick={() => openNewMapWizard()} />;
  let content = (
    <div className="card-grid">
      {entries.map((entry) => (
        <MapCard key={`${entry.ref.area}:${entry.ref.id}`} entry={entry} />
      ))}
    </div>
  );
  if (listing.entries.length === 0) {
    content = (
      <EmptyState icon="map" title="No maps yet" action={newMap}>
        Create a map from a battlemap image, or drop an image anywhere on this page.
      </EmptyState>
    );
  } else if (entries.length === 0) {
    content = <EmptyState icon="search" title={`No maps match "${filter.trim()}"`} />;
  }
  return content;
}
