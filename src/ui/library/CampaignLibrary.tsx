import { useCallback, useEffect, useState } from 'react';
import { createCampaign, createEncounter, type Campaign, type Encounter } from '@/core/model';
import type { LoadProblem } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { TextField } from '../components/fields';

function Problems({ problems }: { problems: LoadProblem[] }) {
  return problems.map((p) => (
    <div key={p.path} className="error-text">
      {p.path} — {p.message}
    </div>
  ));
}

function NewEncounterForm({ campaignId, onCreated }: { campaignId: string; onCreated: () => void }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const maps = useLibraryStore((s) => s.listings.map.entries);
  const [name, setName] = useState('');
  const [mapKey, setMapKey] = useState('');

  const create = async () => {
    const ref = maps.find((m) => `${m.ref.area}:${m.ref.id}` === mapKey)?.ref ?? null;
    await repository.saveEncounter(createEncounter(name.trim(), campaignId, ref));
    setName('');
    onCreated();
  };

  return (
    <div className="row wrap">
      <input placeholder="Encounter name" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={mapKey} onChange={(e) => setMapKey(e.target.value)}>
        <option value="">No map (tracker only)</option>
        {maps.map((m) => (
          <option key={`${m.ref.area}:${m.ref.id}`} value={`${m.ref.area}:${m.ref.id}`}>
            {m.doc.name}
          </option>
        ))}
      </select>
      <button className="primary" disabled={name.trim() === ''} onClick={() => create().catch(reportError)}>
        Create encounter
      </button>
    </div>
  );
}

function EncounterList({ campaign }: { campaign: Campaign }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const navigate = useAppStore((s) => s.navigate);
  const maps = useLibraryStore((s) => s.listings.map.entries);
  const [listing, setListing] = useState<{ encounters: Encounter[]; problems: LoadProblem[] } | null>(null);

  const load = useCallback(
    () => repository.listEncounters(campaign.id).then(setListing, reportError),
    [repository, campaign.id, reportError],
  );
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (encounter: Encounter) => {
    if (window.confirm(`Delete encounter "${encounter.name}"?`)) {
      await repository.removeEncounter(campaign.id, encounter.id);
      await load();
    }
  };

  return (
    <div className="col">
      <h2>Encounters</h2>
      <NewEncounterForm campaignId={campaign.id} onCreated={load} />
      <Problems problems={listing?.problems ?? []} />
      <div className="list">
        {listing?.encounters.map((e) => (
          <div
            key={e.id}
            className="list-item"
            onDoubleClick={() => navigate({ page: 'encounter', campaignId: campaign.id, encounterId: e.id })}
          >
            <span style={{ flex: 1 }}>
              <strong>{e.name}</strong>{' '}
              <span className="muted">
                {e.map ? (maps.find((m) => m.ref.id === e.map?.id)?.doc.name ?? 'missing map') : 'no map'} ·{' '}
                {e.combatants.length} combatants{e.round > 0 ? ` · round ${e.round}` : ''}
              </span>
            </span>
            <button onClick={() => navigate({ page: 'encounter', campaignId: campaign.id, encounterId: e.id })}>
              Open
            </button>
            <button className="danger" onClick={() => remove(e).catch(reportError)}>
              Delete
            </button>
          </div>
        ))}
      </div>
      {listing?.encounters.length === 0 && <p className="muted">No encounters in this campaign yet.</p>}
    </div>
  );
}

export function CampaignLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [listing, setListing] = useState<{ campaigns: Campaign[]; problems: LoadProblem[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const selected = listing?.campaigns.find((c) => c.id === selectedId) ?? null;

  const load = useCallback(() => repository.listCampaigns().then(setListing, reportError), [repository, reportError]);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const campaign = await repository.saveCampaign(createCampaign(newName.trim()));
    setNewName('');
    await load();
    setSelectedId(campaign.id);
  };

  const save = async (campaign: Campaign) => {
    await repository.saveCampaign(campaign);
    await load();
  };

  const remove = async (campaign: Campaign) => {
    if (window.confirm(`Delete campaign "${campaign.name}" with all its encounters?`)) {
      await repository.storage.remove(`campaigns/${campaign.id}`);
      setSelectedId(null);
      await load();
    }
  };

  return (
    <div className="library-split">
      <div className="col">
        <div className="row">
          <input placeholder="Campaign name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="primary" disabled={newName.trim() === ''} onClick={() => create().catch(reportError)}>
            New campaign
          </button>
        </div>
        <Problems problems={listing?.problems ?? []} />
        <div className="list">
          {listing?.campaigns.map((c) => (
            <div
              key={c.id}
              className={c.id === selectedId ? 'list-item selected' : 'list-item'}
              onClick={() => setSelectedId(c.id)}
            >
              {c.name}
            </div>
          ))}
        </div>
        {listing?.campaigns.length === 0 && <p className="muted">No campaigns yet.</p>}
      </div>
      {selected && (
        <div className="col" key={selected.id}>
          <div className="panel">
            <TextField
              label="Name"
              value={selected.name}
              onChange={(name) => save({ ...selected, name }).catch(reportError)}
            />
            <TextField
              label="Notes"
              multiline
              value={selected.notes}
              onChange={(notes) => save({ ...selected, notes }).catch(reportError)}
            />
            <button className="danger" onClick={() => remove(selected).catch(reportError)}>
              Delete campaign
            </button>
          </div>
          <EncounterList campaign={selected} />
        </div>
      )}
    </div>
  );
}
