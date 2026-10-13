import { useState } from 'react';
import { currentSession, newJournalEntry, sortJournal, type JournalEntry } from '@/core/campaign/journal';
import { JOURNAL } from '@/data/campaignFiles';
import { useAppStore } from '@/state/appStore';
import { Field, TextField } from '../components/fields';
import { Button, confirmDialog, EmptyState } from '../kit';
import { EncounterLinks, NotesEditor, Problems, useCampaignDocs, type CampaignTabProps } from './campaignUi';

/** Session journal: one Markdown entry per session; Play appends its notable events to the current one. */
export function JournalTab({ campaignId, encounters }: CampaignTabProps) {
  const reportError = useAppStore((s) => s.reportError);
  const { files, docs, problems, put, drop } = useCampaignDocs(campaignId, JOURNAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = sortJournal(docs ?? []);
  const selected = sorted.find((e) => e.id === selectedId) ?? sorted[0] ?? null;
  const current = currentSession(sorted, new Date());

  const create = async () => {
    const entry = newJournalEntry(sorted, new Date());
    const saved = await files.save(JOURNAL, { ...entry, id: await files.newId(JOURNAL, entry.id) });
    put(saved);
    setSelectedId(saved.id);
    useAppStore.getState().notify(`Created "${saved.title}"`, 'success');
  };

  const update = async (entry: JournalEntry) => put(await files.save(JOURNAL, entry));

  const remove = async (entry: JournalEntry) => {
    const ok = await confirmDialog({
      title: 'Delete journal entry',
      message: `"${entry.title}" (${entry.date}) and its notes will be deleted.`,
      confirmLabel: 'Delete entry',
      danger: true,
    });
    if (ok) {
      await files.remove(JOURNAL, entry.id);
      drop(entry.id);
      useAppStore.getState().notify(`Deleted "${entry.title}"`, 'success');
    }
  };

  const newButton = (
    <Button icon="plus" label="New session" variant="primary" onClick={() => create().catch(reportError)} />
  );
  return (
    <div className="campaign-split">
      <div className="campaign-list">
        <div className="row">
          <span className="muted">{sorted.length} sessions</span>
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
                onChange={(title) => update({ ...selected, title }).catch(reportError)}
              />
            </div>
            <Field label="Date">
              <input
                type="date"
                aria-label="Session date"
                value={selected.date}
                onChange={(e) => update({ ...selected, date: e.target.value }).catch(reportError)}
              />
            </Field>
            <Button icon="trash" label="Delete" variant="danger" onClick={() => remove(selected).catch(reportError)} />
          </div>
          <Field label="Encounters">
            <EncounterLinks
              linked={selected.encounters}
              encounters={encounters}
              onChange={(ids) => update({ ...selected, encounters: ids }).catch(reportError)}
            />
          </Field>
          {selected.id === current?.id && (
            <p className="muted">Combat start and end, fallen combatants, XP and loot from Play are added here.</p>
          )}
          <NotesEditor
            label="Session notes"
            placeholder="What happened, what the players plan next. Markdown: # heading, - list, **bold**."
            value={selected.body}
            onCommit={(body) => update({ ...selected, body })}
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
