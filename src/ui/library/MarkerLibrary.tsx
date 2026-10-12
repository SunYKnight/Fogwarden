import { useState } from 'react';
import { AREA_SHAPES, createMarkerTemplate, type MarkerTemplate } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { ColorField, NumberField, SelectField, TextField } from '../components/fields';
import { confirmDialog } from '../kit';

/** Which dimension fields a shape uses (see `areaDimensionsSchema`). */
const SIZE_LABEL: Record<MarkerTemplate['shape'], string> = {
  cone: 'Length',
  cube: 'Side',
  cylinder: 'Radius',
  line: 'Length',
  sphere: 'Radius',
};

function TemplateEditor({ template }: { template: MarkerTemplate }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const refresh = useLibraryStore((s) => s.refresh);
  // Every committed field is saved at once; shipped templates get a user copy.
  const set = <K extends keyof MarkerTemplate>(key: K, value: MarkerTemplate[K]) =>
    repository
      .save('marker', { ...template, [key]: value })
      .then(() => refresh('marker'))
      .catch(reportError);
  return (
    <div className="panel">
      <TextField label="Name" value={template.name} onChange={(v) => set('name', v)} />
      <SelectField label="Shape" value={template.shape} options={AREA_SHAPES} onChange={(v) => set('shape', v)} />
      <NumberField
        label={SIZE_LABEL[template.shape]}
        suffix="ft"
        min={1}
        value={template.sizeFt}
        onChange={(v) => set('sizeFt', v)}
      />
      {template.shape === 'line' && (
        <NumberField label="Width" suffix="ft" min={1} value={template.widthFt} onChange={(v) => set('widthFt', v)} />
      )}
      {template.shape === 'cylinder' && (
        <NumberField
          label="Height"
          suffix="ft"
          min={1}
          value={template.heightFt}
          onChange={(v) => set('heightFt', v)}
        />
      )}
      <ColorField label="Color" value={template.color} onChange={(v) => set('color', v)} />
      <NumberField
        label="Opacity"
        min={0.05}
        max={1}
        step={0.05}
        value={template.opacity}
        onChange={(v) => set('opacity', v)}
      />
      <TextField label="Notes" multiline value={template.notes} onChange={(v) => set('notes', v)} />
    </div>
  );
}

export function MarkerLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.marker);
  const refresh = useLibraryStore((s) => s.refresh);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = listing.entries.find((e) => e.ref.id === selectedId);

  const create = async () => {
    const stored = await repository.save('marker', createMarkerTemplate('New area'));
    await refresh('marker');
    setSelectedId(stored.id);
  };

  const remove = async (id: string, name: string, overridesContent: boolean) => {
    const ok = await confirmDialog(
      overridesContent
        ? {
            title: 'Restore shipped template',
            message: `Your edits of "${name}" are discarded.`,
            confirmLabel: 'Restore',
          }
        : { title: 'Delete template', message: `"${name}" is deleted.`, confirmLabel: 'Delete', danger: true },
    );
    if (ok) {
      await repository.remove('marker', id);
      await refresh('marker');
    }
  };

  return (
    <div className="library-split">
      <div className="col">
        <div className="row">
          <button className="primary" onClick={() => create().catch(reportError)}>
            New template
          </button>
        </div>
        <div className="list">
          {listing.entries.map(({ ref, doc, overridesContent }) => (
            <div
              key={`${ref.area}:${ref.id}`}
              className={ref.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => setSelectedId(ref.id)}
            >
              <span className="swatch" style={{ background: doc.color }} />
              <span style={{ flex: 1 }}>
                {doc.name}{' '}
                <span className="muted">
                  {doc.shape} {doc.sizeFt} ft
                </span>
              </span>
              <span className={`badge ${ref.area}`}>
                {ref.area === 'content' ? 'shipped' : overridesContent ? 'edited copy' : 'user'}
              </span>
              {ref.area === 'data' && (
                <button
                  className="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(ref.id, doc.name, overridesContent).catch(reportError);
                  }}
                >
                  {overridesContent ? 'Revert' : 'Delete'}
                </button>
              )}
            </div>
          ))}
        </div>
        {listing.entries.length === 0 && <p className="muted">No marker templates yet.</p>}
      </div>
      <div>{selected && <TemplateEditor key={selected.ref.id} template={selected.doc} />}</div>
    </div>
  );
}
