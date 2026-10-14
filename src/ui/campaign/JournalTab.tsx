import { useState } from 'react';
import { currentSession, newJournalEntry, sortJournal, type JournalEntry } from '@/core/campaign/journal';
import { countOf } from '@/core/plural';
import { JOURNAL } from '@/data/campaignFiles';
import { useAppStore } from '@/state/appStore';
import { Field, TextField } from '../components/fields';
import { Button, confirmDialog, EmptyState } from '../kit';
import { activateOnKey } from '../library/listRow';
import { EncounterLinks, NotesEditor, Problems, useCampaignDocs, type CampaignTabProps } from './campaignUi';

/** Session journal: one Markdown entry per session; Play appends its notable events to the current one. */
export function JournalTab({ campaignId, encounters }: CampaignTabProps) {
  const reportError = useAppStore((s) => s.reportError);
  const { files, docs, problems, put, update, remove: removeDoc } = useCampaignDocs(campaignId, JOURNAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sorted = sortJournal(docs ?? []);
  const selected = sorted.find((e) => e.id === selectedId) ?? sorted[0] ?? null;
  const current = currentSession(sorted, new Date());

  const create = async () => {
    setCreating(true);
    try {
      const entry = newJournalEntry(sorted, new Date());
      const saved = await files.save(JOURNAL, { ...entry, id: await files.newId(JOURNAL, entry.id) });
      put(saved);
      setSelectedId(saved.id);
      useAppStore.getState().notify(`Created "${saved.title}"`, 'success');
    } finally {
      setCreating(false);
    }
  };

  const remove = async (entry: JournalEntry) => {
    const ok = await confirmDialog({
      title: 'Delete journal entry',
      message: `"${entry.title}" (${entry.date}) and its notes will be deleted.`,
      confirmLabel: 'Delete entry',
      danger: true,
    });
    if (ok) {
      await removeDoc(entry.id);
      useAppStore.getState().notify(`Deleted "${entry.title}"`, 'success');
    }
  };

  const newButton = (
    <Button
      icon="plus"
      label="New session"
      variant="primary"
      disabled={creating}
      onClick={() => create().catch(reportError)}
    />
  );
  // Before the entries load, an empty list and New session would number the entry as session 1.
  return docs === null ? null : (
    <div className="campaign-split">
      <div className="campaign-list">
        <div className="row">
          <span className="muted">{countOf(sorted.length, 'session')}</span>
          <div className="spacer" />
          {sorted.length > 0 && newButton}
        </div>
        <Problems problems={problems} />
        <div className="list" role="listbox" aria-label="Journal entries">
          {sorted.map((entry) => (
            <div
              key={entry.id}
              role="option"
              tabIndex={0}
              aria-selected={entry.id === selected?.id}
              className={entry.id === selected?.id ? 'list-item selected' : 'list-item'}
              onClick={() => setSelectedId(entry.id)}
              onKeyDown={activateOnKey(() => setSelectedId(entry.id))}
            >
              <span className="row-name">{entry.title}</span>
              {entry.id === current?.id && <span className="status-chip running">current</span>}
              <span className="muted">{entry.date}</span>
            </div>
          ))}
        </div>
      </div>
      {selected ? (
        <div className="campaign-detail" key={selected.id}>
          <div className="row">
            <div className="grow">
              <TextField
                label="Title"
                value={selected.title}
                onChange={(title) => update(selected.id, { title }).catch(reportError)}
              />
            </div>
            <Field label="Date">
              <input
                type="date"
                aria-label="Session date"
                value={selected.date}
                onChange={(e) => update(selected.id, { date: e.target.value }).catch(reportError)}
              />
            </Field>
            <Button icon="trash" label="Delete" variant="danger" onClick={() => remove(selected).catch(reportError)} />
          </div>
          <Field label="Encounters">
            <EncounterLinks
              linked={selected.encounters}
              encounters={encounters}
              onChange={(ids) => update(selected.id, { encounters: ids }).catch(reportError)}
            />
          </Field>
          {selected.id === current?.id && (
            <p className="muted">Combat start and end, fallen combatants, XP and loot from Play are added here.</p>
          )}
          <NotesEditor
            label="Session notes"
            placeholder="What happened, what the players plan next. Markdown: # heading, - list, **bold**."
            value={selected.body}
            onCommit={(body) => update(selected.id, { body })}
          />
        </div>
      ) : (
        <EmptyState icon="journal" title="No sessions written down yet." action={newButton}>
          Start one per session; Play adds combat events to it on its own.
        </EmptyState>
      )}
    </div>
  );
}
