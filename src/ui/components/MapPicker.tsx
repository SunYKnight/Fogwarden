import type { DocRef } from '@/core/model';
import { useLibraryStore } from '@/state/libraryStore';
import { Icon } from '../kit';
import { AssetImage } from './AssetImage';

/** Library maps as picture tiles plus "No map", for choosing where an encounter plays. */
export function MapPicker({ value, onChange }: { value: DocRef | null; onChange: (map: DocRef | null) => void }) {
  const maps = useLibraryStore((s) => s.listings.map.entries);
  const valueKey = value ? `${value.area}:${value.id}` : '';
  return (
    <div className="map-picker" role="listbox" aria-label="Map">
      <button
        type="button"
        role="option"
        aria-selected={value === null}
        className={value === null ? 'map-pick selected' : 'map-pick'}
        onClick={() => onChange(null)}
      >
        <span className="map-pick-thumb">
          <Icon name="list" size={28} />
        </span>
        <span>No map (tracker only)</span>
      </button>
      {maps.map((m) => {
        const key = `${m.ref.area}:${m.ref.id}`;
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={key === valueKey}
            className={key === valueKey ? 'map-pick selected' : 'map-pick'}
            onClick={() => onChange(m.ref)}
          >
            <AssetImage asset={m.doc.image?.asset ?? null} alt="" className="map-pick-thumb" />
            <span>{m.doc.name}</span>
          </button>
        );
      })}
    </div>
  );
}
