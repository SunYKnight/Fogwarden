import type { Encounter } from '@/core/model';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Button, Section } from '../kit';
import { AreaTargets } from './AreaTargets';
import { startAreaPlacement, useEncounterUi } from './encounterUiStore';

/** Area templates as buttons; picking one waits for its origin click on the map. */
export function AreaTemplatePicker({ onPick }: { onPick?: () => void }) {
  const templates = useLibraryStore((s) => s.listings.marker.listed);
  const placement = useEncounterUi((s) => s.placement);
  return templates.length > 0 ? (
    <div className="area-templates">
      {templates.map(({ ref, doc }) => (
        <button
          key={ref.id}
          type="button"
          className={placement?.template.id === doc.id ? 'list-item selected' : 'list-item'}
          title={`${doc.shape} ${doc.sizeFt} ft, click the map to place`}
          onClick={() => {
            startAreaPlacement(doc);
            onPick?.();
          }}
        >
          <span className="swatch" style={{ background: doc.color }} />
          <span className="grow">{doc.name}</span>
          <span className="muted small">
            {doc.shape} {doc.sizeFt} ft
          </span>
        </button>
      ))}
    </div>
  ) : (
    <p className="muted">Create area templates in the Compendium first.</p>
  );
}

/** Areas tab: placed markers with player visibility and removal, plus the template picker. */
export function MarkerPanel({ encounter }: { encounter: Encounter }) {
  const update = useEncounterStore((s) => s.update);
  const targetsId = useEncounterUi((s) => s.areaTargetsId);
  const selected = encounter.markers.find((m) => m.id === targetsId);

  return (
    <div className="col">
      {selected && <AreaTargets key={selected.id} marker={selected} encounter={encounter} />}
      <Section title={`On the map (${encounter.markers.length})`}>
        <div className="list">
          {encounter.markers.map((m) => (
            <div key={m.id} className={m.id === targetsId ? 'list-item selected' : 'list-item'}>
              <span className="swatch" style={{ background: m.color }} />
              <span className="grow">
                {m.label}{' '}
                <span className="muted small">
                  {m.shape} {m.sizeFt} ft
                </span>
              </span>
              <Button
                icon="users"
                label={m.id === targetsId ? 'Hide targets' : 'Targets, saves and damage'}
                iconOnly
                variant="ghost"
                active={m.id === targetsId}
                onClick={() => useEncounterUi.setState({ areaTargetsId: m.id === targetsId ? null : m.id })}
              />
              <Button
                icon={m.visibleToPlayers ? 'eye' : 'eyeOff'}
                label={m.visibleToPlayers ? 'Visible to players' : 'Hidden from players'}
                iconOnly
                variant="ghost"
                active={m.visibleToPlayers}
                onClick={() =>
                  update(
                    (d) => void (d.markers.find((x) => x.id === m.id)!.visibleToPlayers = !m.visibleToPlayers),
                    `${m.visibleToPlayers ? 'Hide' : 'Show'} ${m.label}`,
                  )
                }
              />
              <Button
                icon="trash"
                label="Remove marker"
                iconOnly
                variant="ghost"
                onClick={() =>
                  update((d) => {
                    d.markers = d.markers.filter((x) => x.id !== m.id);
                    addLog(d, 'note', `${m.label} removed`);
                  }, `Remove ${m.label}`)
                }
              />
            </div>
          ))}
          {encounter.markers.length === 0 && <p className="muted small">No areas placed yet.</p>}
        </div>
      </Section>
      <Section title="Place an area">
        <AreaTemplatePicker />
      </Section>
    </div>
  );
}
