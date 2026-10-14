import { useState, type MouseEvent } from 'react';
import type { DocRef } from '@/core/model';
import { HeightField } from '@/core/terrain/heightfield';
import { MY_CONTENT } from '@/data/packs';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { packName, useLibraryStore } from '@/state/libraryStore';
import { AssetImage } from '../components/AssetImage';
import { Button, confirmDialog, EmptyState, Icon, openContextMenu, type MenuItem } from '../kit';
import { openNewEncounter } from './compendiumUi';
import { openNewMapWizard } from './NewMapWizard';
import { MapExportDialog } from './MapExportDialog';
import { countText, setPackEnabled } from './PackLibrary';

async function duplicateMap(ref: DocRef, name: string): Promise<void> {
  const { repository, notify } = useAppStore.getState();
  const copy = await repository.duplicateMap(ref, `${name} copy`);
  await useLibraryStore.getState().refresh('map');
  notify(`Created "${copy.name}"`);
}

/** Deleting a user copy of a pack's map brings the pack's version back. */
async function deleteMap(entry: LibraryEntry<'map'>): Promise<void> {
  const { name } = entry.doc;
  const edited = entry.overrides.length > 0;
  const ok = await confirmDialog({
    title: edited ? 'Delete edited copy' : 'Delete map',
    message: edited
      ? `Your edits to "${name}" are deleted with their images and models; the pack's version comes back.`
      : `"${name}" is deleted with its images and models. Encounters using it will have no map.`,
    confirmLabel: edited ? 'Delete copy' : 'Delete map',
    danger: true,
  });
  if (ok) {
    const { repository, notify } = useAppStore.getState();
    await repository.remove('map', entry.ref.id);
    await useLibraryStore.getState().refresh('map');
    notify(`Deleted "${name}"`);
  }
}

/**
 * Pack files belong to the pack, so a pack's map goes by turning the pack off; Settings > Content brings it
 * back. The confirm names everything else the pack holds, since that goes too.
 */
async function hidePackMap(entry: LibraryEntry<'map'>): Promise<void> {
  const pack = useLibraryStore.getState().packs.find((p) => p.source.pack === entry.pack);
  if (!pack) {
    throw new Error(`The pack "${entry.pack}" of "${entry.doc.name}" is not installed`);
  }
  const { name } = pack.manifest;
  const alone = Object.entries(pack.counts).every(([kind, n]) => n === (kind === 'map' ? 1 : 0));
  const ok = await confirmDialog({
    title: 'Delete map',
    message:
      `"${entry.doc.name}" comes with the pack "${name}" and is removed by turning that pack off` +
      `${alone ? '' : `, which also hides the rest of it (${countText(pack.counts)})`}. Encounters using it ` +
      'will have no map. Turn the pack on again in Settings > Content to get it back.',
    confirmLabel: alone ? 'Delete map' : 'Turn pack off',
    danger: true,
  });
  if (ok) {
    await setPackEnabled(pack, false);
  }
}

function MapCard({ entry }: { entry: LibraryEntry<'map'> }) {
  const navigate = useAppStore((s) => s.navigate);
  const reportError = useAppStore((s) => s.reportError);
  const { ref, doc, pack, overrides } = entry;
  const shipped = pack !== MY_CONTENT;
  const fromPack = useLibraryStore((s) => packName(s.packs, pack));
  const edit = () => navigate({ page: 'map-editor', map: ref });
  const duplicate = () => duplicateMap(ref, doc.name).catch(reportError);
  const remove = () => (shipped ? hidePackMap(entry) : deleteMap(entry)).catch(reportError);
  const [exporting, setExporting] = useState(false);
  const loadForExport = async () => {
    const map = await useAppStore.getState().repository.load('map', ref);
    return { map, terrain: HeightField.fromMap(map) };
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: 'Edit', icon: 'edit', run: edit },
      { label: 'Duplicate', icon: 'copy', run: duplicate },
      { label: 'Use in a new encounter', icon: 'swords', run: () => openNewEncounter(null, ref) },
      { label: 'Export…', icon: 'download', run: () => setExporting(true) },
      { label: 'Delete', icon: 'trash', danger: true, run: remove },
    ];
    openContextMenu(e.clientX, e.clientY, items);
  };

  return (
    <>
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
              <span className="badge" title={`From the pack "${fromPack}"; editing creates your copy`}>
                <Icon name="lock" size={12} /> {fromPack}
              </span>
            )}
            {overrides.length > 0 && (
              <span className="badge data" title="Your copy of a pack's map">
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
            <Button icon="trash" label="Delete" iconOnly variant="danger" onClick={remove} />
          </div>
        </div>
      </div>
      {exporting && <MapExportDialog name={doc.name} load={loadForExport} onClose={() => setExporting(false)} />}
    </>
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
