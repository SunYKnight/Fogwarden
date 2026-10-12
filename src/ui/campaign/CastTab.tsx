import { useRef, useState } from 'react';
import { appearsIn, type CastEntry, type CastKind } from '@/core/campaign/people';
import { splitList } from '@/core/frontMatter';
import { nowIso } from '@/core/model';
import { CAST } from '@/data/campaignFiles';
import { useAppStore } from '@/state/appStore';
import { AssetImage } from '../components/AssetImage';
import { Field, SelectField, TextField } from '../components/fields';
import { Button, confirmDialog, EmptyState, Icon, type IconName } from '../kit';
import {
  EncounterLinks,
  NameDialog,
  NotesEditor,
  Problems,
  useCampaignDocs,
  type CampaignTabProps,
} from './campaignUi';

type Filter = 'all' | CastKind;

const KIND_LABEL: Record<CastKind, { label: string; icon: IconName }> = {
  person: { label: 'Person', icon: 'user' },
  place: { label: 'Place', icon: 'pin' },
};

const FILTERS: Record<Filter, string> = { all: 'All', person: 'People', place: 'Places' };

/** NPCs and locations with picture, tags, notes and the encounters they appear in. */
export function CastTab({ campaignId, encounters }: CampaignTabProps) {
  const reportError = useAppStore((s) => s.reportError);
  const { files, docs, problems, put, drop } = useCampaignDocs(campaignId, CAST);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const [creating, setCreating] = useState<CastKind | null>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  const needle = text.trim().toLowerCase();
  const shown = (docs ?? [])
    .filter((d) => filter === 'all' || d.kind === filter)
    .filter((d) => needle === '' || [d.name, ...d.tags].some((t) => t.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = (docs ?? []).find((d) => d.id === selectedId) ?? null;

  const create = async (kind: CastKind, name: string) => {
    const at = nowIso();
    const entry: CastEntry = {
      id: await files.newId(CAST, name),
      name,
      kind,
      picture: null,
      tags: [],
      encounters: [],
      createdAt: at,
      updatedAt: at,
      notes: '',
    };
    const saved = await files.save(CAST, entry);
    put(saved);
    setSelectedId(saved.id);
    useAppStore.getState().notify(`Created "${saved.name}"`, 'success');
  };

  const update = async (entry: CastEntry) => put(await files.save(CAST, entry));

  const remove = async (entry: CastEntry) => {
    const ok = await confirmDialog({
      title: `Delete ${entry.kind}`,
      message: `"${entry.name}" with notes${entry.picture ? ' and picture' : ''} will be deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      await files.removePicture(entry);
      await files.remove(CAST, entry.id);
      drop(entry.id);
      useAppStore.getState().notify(`Deleted "${entry.name}"`, 'success');
    }
  };

  const pickPicture = async (file: File) => {
    put(await files.importPicture(selected!, file.name, new Uint8Array(await file.arrayBuffer())));
    useAppStore.getState().notify(`Picture set for "${selected!.name}"`, 'success');
  };

  const mentioned = selected
    ? encounters.filter((e) => !selected.encounters.includes(e.id) && appearsIn(selected, e)).map((e) => e.id)
    : [];
  return (
    <div className="campaign-split">
      <div className="campaign-list">
        <div className="row">
          <Button icon="plus" label="New person" variant="primary" onClick={() => setCreating('person')} />
          <Button icon="pin" label="New place" onClick={() => setCreating('place')} />
        </div>
        <div className="row">
          <input
            type="search"
            className="grow"
            aria-label="Search people and places"
            placeholder="Search name or tag"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {Object.entries(FILTERS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Problems problems={problems} />
        <div className="list" role="listbox" aria-label="People and places">
          {shown.map((entry) => (
            <div
              key={entry.id}
              role="option"
              tabIndex={0}
              aria-selected={entry.id === selectedId}
              className={entry.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => setSelectedId(entry.id)}
            >
              <AssetImage asset={files.pictureRef(entry)} alt="" className="cast-thumb" />
              <Icon name={KIND_LABEL[entry.kind].icon} size={14} title={KIND_LABEL[entry.kind].label} />
              <span className="row-name">{entry.name}</span>
              <span className="muted">{entry.tags.join(', ')}</span>
            </div>
          ))}
        </div>
        {docs !== null && shown.length === 0 && (
          <EmptyState icon="users" title={docs.length === 0 ? 'No people or places yet.' : 'Nothing matches.'}>
            NPCs, villains, towns and dungeons, with a picture and notes.
          </EmptyState>
        )}
      </div>
      {selected ? (
        <div className="campaign-detail cast-detail" key={selected.id}>
          <div className="cast-head">
            <button
              type="button"
              className="cast-picture"
              title="Choose a picture (PNG, JPEG, WebP)"
              onClick={() => pictureInput.current?.click()}
            >
              {selected.picture ? (
                <AssetImage asset={files.pictureRef(selected)} alt={selected.name} />
              ) : (
                <span className="muted">
                  <Icon name="image" size={28} />
                  <br />
                  Add picture
                </span>
              )}
            </button>
            <input
              ref={pictureInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pickPicture(file).catch(reportError);
                e.target.value = '';
              }}
            />
            <div className="col grow">
              <TextField
                label="Name"
                value={selected.name}
                onChange={(name) => update({ ...selected, name }).catch(reportError)}
              />
              <SelectField
                label="Kind"
                value={selected.kind}
                options={['person', 'place'] as CastKind[]}
                format={(k) => KIND_LABEL[k].label}
                onChange={(kind) => update({ ...selected, kind }).catch(reportError)}
              />
              <TextField
                label="Tags"
                placeholder="noble, Waterdeep"
                value={selected.tags.join(', ')}
                onChange={(tags) => update({ ...selected, tags: splitList(tags) }).catch(reportError)}
              />
            </div>
            <Button icon="trash" label="Delete" variant="danger" onClick={() => remove(selected).catch(reportError)} />
          </div>
          <Field label="Appears in" title="Linked by hand, or named in an encounter, its notes or combatants">
            <EncounterLinks
              linked={selected.encounters}
              mentioned={mentioned}
              encounters={encounters}
              onChange={(ids) => update({ ...selected, encounters: ids }).catch(reportError)}
            />
          </Field>
          <NotesEditor
            label={`Notes on ${selected.name}`}
            placeholder="Looks, wants, secrets, what the party knows."
            value={selected.notes}
            onCommit={(notes) => update({ ...selected, notes })}
          />
        </div>
      ) : (
        <EmptyState icon="users" title="Select a person or place to see and edit it." />
      )}
      {creating && (
        <NameDialog
          title={creating === 'person' ? 'New person' : 'New place'}
          initial=""
          confirmLabel="Create"
          onSubmit={(name) => create(creating, name)}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}
