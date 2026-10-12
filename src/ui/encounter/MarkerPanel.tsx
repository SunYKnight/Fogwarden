import type { Encounter } from '@/core/model';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { useEncounterUi } from './encounterUiStore';

/** Area markers: place one from a template, toggle what players see, remove. */
export function MarkerPanel({ encounter }: { encounter: Encounter }) {
  const update = useEncounterStore((s) => s.update);
  const templates = useLibraryStore((s) => s.listings.marker.entries);
  const placement = useEncounterUi((s) => s.placement);

  return (
    <div className="panel">
      <h2>Area markers</h2>
      <div className="row wrap">
        {templates.map(({ ref, doc }) => (
          <button
            key={ref.id}
            className={placement?.template.id === doc.id ? 'active' : ''}
            title={`${doc.shape} ${doc.sizeFt} ft — click the map to place`}
            onClick={() =>
              useEncounterUi.setState({ placement: { template: doc, origin: null }, placingId: null, tool: 'select' })
            }
          >
            <span className="swatch" style={{ background: doc.color }} /> {doc.name}
          </button>
        ))}
      </div>
      {templates.length === 0 && <p className="muted">Create marker templates in the library first.</p>}
      <div className="list">
        {encounter.markers.map((m) => (
          <div key={m.id} className="list-item">
            <span className="swatch" style={{ background: m.color }} />
            <span className="grow">
              {m.label}{' '}
              <span className="muted small">
                {m.shape} {m.sizeFt} ft
              </span>
            </span>
            <label className="row small" title="Visible to players">
              <input
                type="checkbox"
                checked={m.visibleToPlayers}
                onChange={(e) => {
                  const visible = e.target.checked;
                  update((d) => void (d.markers.find((x) => x.id === m.id)!.visibleToPlayers = visible));
                }}
              />
              players
            </label>
            <button
              title="Remove marker"
              onClick={() =>
                update((d) => {
                  d.markers = d.markers.filter((x) => x.id !== m.id);
                  addLog(d, 'note', `${m.label} removed`);
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
