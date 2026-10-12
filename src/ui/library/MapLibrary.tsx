import { useRef, useState } from 'react';
import type { DocRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { AssetImage } from '../components/AssetImage';
import { confirmDialog } from '../kit';
import { createMapFromImage } from './mapImport';

export function MapLibrary() {
  const repository = useAppStore((s) => s.repository);
  const navigate = useAppStore((s) => s.navigate);
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.map);
  const refresh = useLibraryStore((s) => s.refresh);
  const fileInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (file) {
      setBusy(true);
      try {
        const map = await createMapFromImage(repository, file);
        await refresh('map');
        navigate({ page: 'map-editor', map: { area: 'data', id: map.id } });
      } finally {
        setBusy(false);
      }
    }
  };

  const duplicate = async (ref: DocRef, name: string) => {
    await repository.duplicateMap(ref, `${name} copy`);
    await refresh('map');
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: 'Delete map',
      message: `"${name}" is deleted with its images and models. Encounters using it will have no map.`,
      confirmLabel: 'Delete map',
      danger: true,
    });
    if (ok) {
      await repository.remove('map', id);
      await refresh('map');
    }
  };

  const needle = filter.toLowerCase();
  const entries = listing.entries.filter(
    (e) => e.doc.name.toLowerCase().includes(needle) || e.doc.tags.some((t) => t.toLowerCase().includes(needle)),
  );

  return (
    <div className="col">
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Importing…' : 'New map from image…'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]).catch(reportError);
            e.target.value = '';
          }}
        />
        <input placeholder="Filter by name or tag" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="card-grid">
        {entries.map(({ ref, doc, overridesContent }) => (
          <div key={`${ref.area}:${ref.id}`} className="card">
            <AssetImage asset={doc.image?.asset ?? null} alt={doc.name} />
            <div className="body">
              <strong>{doc.name}</strong>
              <span className="muted">
                {doc.grid.squaresX}×{doc.grid.squaresY} squares
                {ref.area === 'content' ? ' · shipped' : overridesContent ? ' · edited copy' : ''}
              </span>
              <div className="row">
                <button onClick={() => navigate({ page: 'map-editor', map: ref })}>Edit</button>
                <button onClick={() => duplicate(ref, doc.name).catch(reportError)}>Duplicate</button>
                {ref.area === 'data' && (
                  <button className="danger" onClick={() => remove(ref.id, doc.name).catch(reportError)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {entries.length === 0 && <p className="muted">No maps yet. Create one from a battlemap image.</p>}
    </div>
  );
}
