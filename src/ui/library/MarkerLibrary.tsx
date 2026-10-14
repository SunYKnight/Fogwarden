import { useState, type MouseEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import {
  ABILITIES,
  AREA_SHAPES,
  createMarkerTemplate,
  DAMAGE_TYPES,
  type AreaSave,
  type MarkerTemplate,
} from '@/core/model';
import { MY_CONTENT } from '@/data/packs';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { packName, useLibraryStore } from '@/state/libraryStore';
import { CheckboxField, ColorField, NumberField, SelectField, TextField } from '../components/fields';
import { Button, confirmDialog, EmptyState, openContextMenu, Section } from '../kit';
import { activateOnKey } from './listRow';
import { OriginBadge } from './OriginBadge';
import { serialQueue } from './serialQueue';

type Entry = LibraryEntry<'marker'>;

// The header action creates a template the list then selects; `creating` stops a double click making two.
const useMarkerUi = create<{ selectedId: string | null; creating: boolean }>(() => ({
  selectedId: null,
  creating: false,
}));

async function createTemplate(): Promise<void> {
  const repository = useAppStore.getState().repository;
  useMarkerUi.setState({ creating: true });
  try {
    const id = await repository.newLibraryId('marker', 'New area');
    const stored = await repository.save('marker', { ...createMarkerTemplate('New area'), id });
    await useLibraryStore.getState().refresh('marker');
    useMarkerUi.setState({ selectedId: stored.id });
  } finally {
    useMarkerUi.setState({ creating: false });
  }
}

/** Compendium header actions of the Area templates tab. */
export function MarkerActions() {
  const reportError = useAppStore((s) => s.reportError);
  const creating = useMarkerUi((s) => s.creating);
  return (
    <Button
      icon="plus"
      label="New template"
      variant="primary"
      disabled={creating}
      onClick={() => createTemplate().catch(reportError)}
    />
  );
}

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
const INNER = VIEW - 2 * PAD;
const MID = VIEW / 2;

interface AreaStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
}

function radialDrawing(t: MarkerTemplate, style: AreaStyle): { shape: ReactNode; label: string } {
  return {
    shape: (
      <>
        <circle cx={MID} cy={MID} r={INNER / 2} {...style} />
        <line x1={MID} y1={MID} x2={MID + INNER / 2} y2={MID} stroke="currentColor" strokeDasharray="4 3" />
      </>
    ),
    label: `r ${t.sizeFt} ft${t.shape === 'cylinder' ? ` · h ${t.heightFt} ft` : ''}`,
  };
}

const AREA_DRAWING: Record<
  MarkerTemplate['shape'],
  (t: MarkerTemplate, style: AreaStyle) => { shape: ReactNode; label: string }
> = {
  sphere: radialDrawing,
  cylinder: radialDrawing,
  cube: (t, style) => ({
    shape: <rect x={PAD} y={PAD} width={INNER} height={INNER} {...style} />,
    label: `${t.sizeFt} × ${t.sizeFt} ft`,
  }),
  line: (t, style) => {
    const thick = Math.max(4, (INNER * t.widthFt) / Math.max(t.sizeFt, t.widthFt));
    return {
      shape: <rect x={PAD} y={MID - thick / 2} width={INNER} height={thick} {...style} />,
      label: `${t.sizeFt} ft × ${t.widthFt} ft`,
    };
  },
  // A 5e cone is as wide at its end as it is long.
  cone: (t, style) => ({
    shape: <polygon points={`${PAD},${MID} ${VIEW - PAD},${PAD} ${VIEW - PAD},${VIEW - PAD}`} {...style} />,
    label: `${t.sizeFt} ft long`,
  }),
};

/** Top-down drawing of the area with its dimensions, scaled to fit the preview box; `thumb` drops the caption. */
function AreaPreview({ t, thumb = false }: { t: MarkerTemplate; thumb?: boolean }) {
  const { shape, label } = AREA_DRAWING[t.shape](t, {
    fill: t.color,
    fillOpacity: t.opacity,
    stroke: t.color,
    strokeWidth: 2,
  });
  const drawing = (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="img"
      aria-label={`${t.shape}, ${label}`}
      className={thumb ? 'area-thumb' : undefined}
    >
      {shape}
    </svg>
  );
  return thumb ? (
    drawing
  ) : (
    <figure className="area-preview">
      {drawing}
      <figcaption>
        {t.shape} · {label}
      </figcaption>
    </figure>
  );
}

const NEW_SAVE: AreaSave = { ability: 'dex', dc: 13, damage: '', damageType: 'fire', halfOnSuccess: true };

/** Saving throw the Play view's Areas tab prefills for creatures inside the area. */
function SaveFields({
  save,
  onChange,
}: {
  save: AreaSave | undefined;
  onChange: (save: AreaSave | undefined) => void;
}) {
  return (
    <>
      <CheckboxField
        label="Saving throw"
        value={save !== undefined}
        onChange={(v) => onChange(v ? NEW_SAVE : undefined)}
      />
      {save && (
        <>
          <SelectField
            label="Save"
            value={save.ability}
            options={ABILITIES}
            format={(a) => a.toUpperCase()}
            onChange={(ability) => onChange({ ...save, ability })}
          />
          <NumberField
            label="DC"
            min={1}
            max={40}
            value={save.dc}
            onChange={(v) => onChange({ ...save, dc: Math.round(v) })}
          />
          <TextField
            label="Damage"
            placeholder="8d6"
            value={save.damage}
            onChange={(damage) => onChange({ ...save, damage: damage.trim() })}
          />
          <SelectField
            label="Damage type"
            value={save.damageType}
            options={DAMAGE_TYPES}
            onChange={(damageType) => onChange({ ...save, damageType })}
          />
          <CheckboxField
            label="Half damage on a successful save"
            value={save.halfOnSuccess}
            onChange={(halfOnSuccess) => onChange({ ...save, halfOnSuccess })}
          />
        </>
      )}
    </>
  );
}

function TemplateEditor({ template }: { template: MarkerTemplate }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const refresh = useLibraryStore((s) => s.refresh);
  // Edits apply to the newest listed template, so a quick second edit keeps the first.
  const [queue] = useState(serialQueue);
  // Every committed field is saved at once; pack templates get a user copy.
  const set = <K extends keyof MarkerTemplate>(key: K, value: MarkerTemplate[K]) =>
    queue(async () => {
      const latest = useLibraryStore.getState().listings.marker.entries.find((e) => e.ref.id === template.id)?.doc;
      await repository.save('marker', { ...(latest ?? template), [key]: value });
      await refresh('marker');
    }).catch(reportError);
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
      <SaveFields save={template.save} onChange={(v) => set('save', v)} />
      <TextField label="Notes" multiline value={template.notes} onChange={(v) => set('notes', v)} />
    </Section>
  );
}

export function MarkerLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.marker);
  const refresh = useLibraryStore((s) => s.refresh);
  const selectedId = useMarkerUi((s) => s.selectedId);
  const creating = useMarkerUi((s) => s.creating);
  const [text, setText] = useState('');
  const selected = listing.entries.find((e) => e.ref.id === selectedId);
  const needle = text.toLowerCase();
  const entries = listing.listed.filter((e) => e.doc.name.toLowerCase().includes(needle));

  const remove = async ({ ref, doc, overrides }: Entry) => {
    const original = overrides[0] && packName(useLibraryStore.getState().packs, overrides[0]);
    const ok = await confirmDialog(
      original
        ? {
            title: 'Revert to pack version',
            message: `Your copy of "${doc.name}" is deleted and the version from "${original}" comes back.`,
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
    useMarkerUi.setState({ selectedId: entry.ref.id });
    openContextMenu(e.clientX, e.clientY, [
      {
        label: entry.overrides.length > 0 ? 'Revert to pack version' : 'Delete',
        icon: entry.overrides.length > 0 ? 'undo' : 'trash',
        danger: true,
        disabled: entry.pack !== MY_CONTENT,
        run: () => remove(entry).catch(reportError),
      },
    ]);
  };

  return (
    <div className="compendium-split">
      <div className="compendium-list">
        <input
          type="search"
          aria-label="Search templates"
          placeholder="Search templates"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="list" role="listbox" aria-label="Area templates">
          {entries.map((entry) => (
            <div
              key={`${entry.ref.area}:${entry.ref.id}`}
              role="option"
              tabIndex={0}
              aria-selected={entry.ref.id === selectedId}
              className={entry.ref.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => useMarkerUi.setState({ selectedId: entry.ref.id })}
              onKeyDown={activateOnKey(() => useMarkerUi.setState({ selectedId: entry.ref.id }))}
              onContextMenu={(e) => showMenu(e, entry)}
            >
              <AreaPreview t={entry.doc} thumb />
              <span className="row-name">{entry.doc.name}</span>
              <span className="muted">
                {entry.doc.shape} {entry.doc.sizeFt} ft
              </span>
              <OriginBadge entry={entry} />
            </div>
          ))}
        </div>
        {entries.length === 0 && (
          <EmptyState
            icon="area"
            title={listing.listed.length === 0 ? 'No area templates yet.' : 'No templates match.'}
            action={
              <Button
                icon="plus"
                label="New template"
                disabled={creating}
                onClick={() => createTemplate().catch(reportError)}
              />
            }
          />
        )}
      </div>
      <div className="creature-preview">
        {selected ? (
          <div className="col" key={selected.ref.id}>
            <div className="row">
              <strong>{selected.doc.name}</strong>
              <div className="spacer" />
              {selected.pack === MY_CONTENT && (
                <Button
                  icon={selected.overrides.length > 0 ? 'undo' : 'trash'}
                  label={selected.overrides.length > 0 ? 'Revert' : 'Delete'}
                  variant="danger"
                  onClick={() => remove(selected).catch(reportError)}
                />
              )}
            </div>
            {selected.pack !== MY_CONTENT && (
              <p className="hint-bar">From a pack: changes create your copy, which you can revert later.</p>
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
