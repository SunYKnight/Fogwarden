import { useState, type MouseEvent, type ReactNode } from 'react';
import { AREA_SHAPES, createMarkerTemplate, type MarkerTemplate } from '@/core/model';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { ColorField, NumberField, SelectField, TextField } from '../components/fields';
import { Button, confirmDialog, EmptyState, Icon, openContextMenu, Section } from '../kit';

type Entry = LibraryEntry<'marker'>;

/** Which dimension fields a shape uses (see `areaDimensionsSchema`). */
const SIZE_LABEL: Record<MarkerTemplate['shape'], string> = {
  cone: 'Length',
  cube: 'Side',
  cylinder: 'Radius',
  line: 'Length',
  sphere: 'Radius',
};

const VIEW = 200;
const PAD = 24;

/** Top-down drawing of the area with its dimensions, scaled to fit the preview box. */
function AreaPreview({ t }: { t: MarkerTemplate }) {
  const style = { fill: t.color, fillOpacity: t.opacity, stroke: t.color, strokeWidth: 2 };
  const inner = VIEW - 2 * PAD;
  const mid = VIEW / 2;
  const radial = t.shape === 'sphere' || t.shape === 'cylinder';
  let shape: ReactNode;
  let label: string;
  if (radial) {
    shape = (
      <>
        <circle cx={mid} cy={mid} r={inner / 2} {...style} />
        <line x1={mid} y1={mid} x2={mid + inner / 2} y2={mid} stroke="currentColor" strokeDasharray="4 3" />
      </>
    );
    label = `r ${t.sizeFt} ft${t.shape === 'cylinder' ? ` · h ${t.heightFt} ft` : ''}`;
  } else if (t.shape === 'cube') {
    shape = <rect x={PAD} y={PAD} width={inner} height={inner} {...style} />;
    label = `${t.sizeFt} × ${t.sizeFt} ft`;
  } else if (t.shape === 'line') {
    const thick = Math.max(4, (inner * t.widthFt) / Math.max(t.sizeFt, t.widthFt));
    shape = <rect x={PAD} y={mid - thick / 2} width={inner} height={thick} {...style} />;
    label = `${t.sizeFt} ft × ${t.widthFt} ft`;
  } else {
    // A 5e cone is as wide at its end as it is long.
    shape = <polygon points={`${PAD},${mid} ${VIEW - PAD},${PAD} ${VIEW - PAD},${VIEW - PAD}`} {...style} />;
    label = `${t.sizeFt} ft long`;
  }
  return (
    <figure className="area-preview">
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={`${t.shape}, ${label}`}>
        {shape}
      </svg>
      <figcaption>
        {t.shape} · {label}
      </figcaption>
    </figure>
  );
}

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
    <Section title="Properties">
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
    </Section>
  );
}

export function MarkerLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.marker);
  const refresh = useLibraryStore((s) => s.refresh);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const selected = listing.entries.find((e) => e.ref.id === selectedId);
  const needle = text.toLowerCase();
  const entries = listing.entries.filter((e) => e.doc.name.toLowerCase().includes(needle));

  const create = async () => {
    const stored = await repository.save('marker', createMarkerTemplate('New area'));
    await refresh('marker');
    setSelectedId(stored.id);
  };

  const remove = async ({ ref, doc, overridesContent }: Entry) => {
    const ok = await confirmDialog(
      overridesContent
        ? {
            title: 'Revert to shipped template',
            message: `Your copy of "${doc.name}" is deleted and the shipped version comes back.`,
            confirmLabel: 'Revert',
            danger: true,
          }
        : { title: 'Delete template', message: `"${doc.name}" is deleted.`, confirmLabel: 'Delete', danger: true },
    );
    if (ok) {
      await repository.remove('marker', ref.id);
      await refresh('marker');
    }
  };

  const showMenu = (e: MouseEvent, entry: Entry) => {
    e.preventDefault();
    setSelectedId(entry.ref.id);
    openContextMenu(e.clientX, e.clientY, [
      {
        label: entry.overridesContent ? 'Revert to shipped' : 'Delete',
        icon: entry.overridesContent ? 'undo' : 'trash',
        danger: true,
        disabled: entry.ref.area === 'content',
        run: () => remove(entry).catch(reportError),
      },
    ]);
  };

  return (
    <div className="compendium-split">
      <div className="compendium-list">
        <div className="row">
          <input
            type="search"
            aria-label="Search templates"
            placeholder="Search templates"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="spacer" />
          <Button icon="plus" label="New template" variant="primary" onClick={() => create().catch(reportError)} />
        </div>
        <div className="list" role="listbox" aria-label="Area templates">
          {entries.map((entry) => (
            <div
              key={`${entry.ref.area}:${entry.ref.id}`}
              role="option"
              tabIndex={0}
              aria-selected={entry.ref.id === selectedId}
              className={entry.ref.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => setSelectedId(entry.ref.id)}
              onContextMenu={(e) => showMenu(e, entry)}
            >
              <span className="swatch" style={{ background: entry.doc.color }} />
              <span className="row-name">{entry.doc.name}</span>
              <span className="muted">
                {entry.doc.shape} {entry.doc.sizeFt} ft
              </span>
              <span className={`badge ${entry.ref.area}`}>
                {entry.ref.area === 'content' && <Icon name="lock" size={12} />}{' '}
                {entry.ref.area === 'content' ? 'shipped' : entry.overridesContent ? 'your copy' : 'yours'}
              </span>
            </div>
          ))}
        </div>
        {entries.length === 0 && (
          <EmptyState
            icon="area"
            title={listing.entries.length === 0 ? 'No area templates yet.' : 'No templates match.'}
            action={<Button icon="plus" label="New template" onClick={() => create().catch(reportError)} />}
          />
        )}
      </div>
      <div className="creature-preview">
        {selected ? (
          <div className="col" key={selected.ref.id}>
            <div className="row">
              <strong>{selected.doc.name}</strong>
              <div className="spacer" />
              {selected.ref.area === 'data' && (
                <Button
                  icon={selected.overridesContent ? 'undo' : 'trash'}
                  label={selected.overridesContent ? 'Revert' : 'Delete'}
                  variant="danger"
                  onClick={() => remove(selected).catch(reportError)}
                />
              )}
            </div>
            {selected.ref.area === 'content' && (
              <p className="hint-bar">Shipped template: changes create your copy, which you can revert later.</p>
            )}
            <AreaPreview t={selected.doc} />
            <TemplateEditor template={selected.doc} />
          </div>
        ) : (
          <EmptyState icon="area" title="Select a template to see and edit it." />
        )}
      </div>
    </div>
  );
}
