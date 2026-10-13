import { useEffect, useState } from 'react';
import type { AssetRef } from '@/core/model';
import type { PortraitEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { packName, useLibraryStore } from '@/state/libraryStore';
import { AssetImage } from '../components/AssetImage';
import { Dialog, EmptyState } from '../kit';

/** "half orc male barbarian.jpg" → "half orc male barbarian". */
function label(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Picture library: every picture in the `portraits/` folders of My content and the enabled packs (Aurora
 * Builder's portraits after an import), as thumbnails with a search.
 */
export function PictureLibraryDialog({ onPick, onClose }: { onPick: (ref: AssetRef) => void; onClose: () => void }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const packs = useLibraryStore((s) => s.packs);
  const [portraits, setPortraits] = useState<PortraitEntry[] | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    repository.listPortraits().then(setPortraits, reportError);
  }, [repository, reportError]);

  const needle = text.toLowerCase();
  const shown = (portraits ?? []).filter((p) => p.name.toLowerCase().includes(needle));
  return (
    <Dialog title="Picture library" onClose={onClose} width={720}>
      <div className="col">
        <input
          type="search"
          aria-label="Search pictures"
          placeholder="Search pictures"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {portraits !== null && shown.length === 0 ? (
          <EmptyState icon="image" title={portraits.length === 0 ? 'No pictures yet.' : 'No picture matches.'}>
            {portraits.length === 0 &&
              'Pictures in a portraits folder of your library or a pack show here, e.g. after importing ' +
                'from Aurora Builder (Settings > Content).'}
          </EmptyState>
        ) : (
          <div className="picture-grid" role="listbox" aria-label="Pictures">
            {shown.map((p) => (
              <button
                key={`${p.ref.area}:${p.ref.path}`}
                type="button"
                role="option"
                aria-selected={false}
                className="picture-tile"
                title={`${label(p.name)} (${packName(packs, p.pack)})`}
                onClick={() => {
                  onPick(p.ref);
                  onClose();
                }}
              >
                <AssetImage asset={p.ref} alt={label(p.name)} className="picture-thumb" />
                <span className="small">{label(p.name)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
