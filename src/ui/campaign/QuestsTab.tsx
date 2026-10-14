import { useState } from 'react';
import { QUEST_STATUSES, type Quest, type QuestStatus } from '@/core/campaign/quests';
import { nowIso } from '@/core/model';
import { QUESTS } from '@/data/campaignFiles';
import { useAppStore } from '@/state/appStore';
import { Field, TextField } from '../components/fields';
import { Button, confirmDialog, EmptyState, type IconName } from '../kit';
import { activateOnKey } from '../library/listRow';
import { NameDialog, NotesEditor, Problems, useCampaignDocs, type CampaignTabProps } from './campaignUi';

const STATUS: Record<QuestStatus, { label: string; icon: IconName; chip: string }> = {
  open: { label: 'Open', icon: 'flag', chip: 'running' },
  done: { label: 'Done', icon: 'check', chip: 'finished' },
  failed: { label: 'Failed', icon: 'close', chip: 'failed' },
};

/** Quests by status (open first), each with Markdown notes. */
export function QuestsTab({ campaignId }: CampaignTabProps) {
  const reportError = useAppStore((s) => s.reportError);
  const { files, docs, problems, put, update, remove: removeDoc } = useCampaignDocs(campaignId, QUESTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = (docs ?? []).find((q) => q.id === selectedId) ?? null;

  const create = async (name: string) => {
    const at = nowIso();
    const quest: Quest = {
      id: await files.newId(QUESTS, name),
      name,
      status: 'open',
      createdAt: at,
      updatedAt: at,
      notes: '',
    };
    const saved = await files.save(QUESTS, quest);
    put(saved);
    setSelectedId(saved.id);
    useAppStore.getState().notify(`Created "${saved.name}"`, 'success');
  };

  const remove = async (quest: Quest) => {
    const ok = await confirmDialog({
      title: 'Delete quest',
      message: `"${quest.name}" and its notes will be deleted.`,
      confirmLabel: 'Delete quest',
      danger: true,
    });
    if (ok) {
      await removeDoc(quest.id);
      useAppStore.getState().notify(`Deleted "${quest.name}"`, 'success');
    }
  };

  const newButton = <Button icon="plus" label="New quest" variant="primary" onClick={() => setCreating(true)} />;
  return (
    <div className="campaign-split">
      <div className="campaign-list">
        <div className="row">
          <span className="muted">{(docs ?? []).filter((q) => q.status === 'open').length} open</span>
          <div className="spacer" />
          {docs?.length !== 0 && newButton}
        </div>
        <Problems problems={problems} />
        {QUEST_STATUSES.map((status) => {
          const quests = (docs ?? []).filter((q) => q.status === status).sort((a, b) => a.name.localeCompare(b.name));
          return (
            quests.length > 0 && (
              <div key={status} className="col">
                <h3 className="list-heading">
                  {STATUS[status].label} ({quests.length})
                </h3>
                <div className="list" role="listbox" aria-label={`${STATUS[status].label} quests`}>
                  {quests.map((quest) => (
                    <div
                      key={quest.id}
                      role="option"
                      tabIndex={0}
                      aria-selected={quest.id === selectedId}
                      className={quest.id === selectedId ? 'list-item selected' : 'list-item'}
                      onClick={() => setSelectedId(quest.id)}
                      onKeyDown={activateOnKey(() => setSelectedId(quest.id))}
                    >
                      <span className="row-name">{quest.name}</span>
                      <span className={`status-chip ${STATUS[quest.status].chip}`}>{STATUS[quest.status].label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          );
        })}
        {docs?.length === 0 && (
          <EmptyState icon="flag" title="No quests yet." action={newButton}>
            Track what the party set out to do and how it ended.
          </EmptyState>
        )}
      </div>
      {selected ? (
        <div className="campaign-detail" key={selected.id}>
          <div className="row">
            <div className="grow">
              <TextField
                label="Quest"
                value={selected.name}
                onChange={(name) => update(selected.id, { name }).catch(reportError)}
              />
            </div>
            <Button icon="trash" label="Delete" variant="danger" onClick={() => remove(selected).catch(reportError)} />
          </div>
          <Field label="Status">
            <div className="row" role="group" aria-label="Quest status">
              {QUEST_STATUSES.map((status) => (
                <Button
                  key={status}
                  icon={STATUS[status].icon}
                  label={STATUS[status].label}
                  active={selected.status === status}
                  onClick={() => update(selected.id, { status }).catch(reportError)}
                />
              ))}
            </div>
          </Field>
          <NotesEditor
            label={`Notes on ${selected.name}`}
            placeholder="Who gave it, the reward, leads, what is still unknown."
            value={selected.notes}
            onCommit={(notes) => update(selected.id, { notes })}
          />
        </div>
      ) : (
        <EmptyState icon="flag" title="Select a quest to see and edit it." />
      )}
      {creating && (
        <NameDialog
          title="New quest"
          initial=""
          confirmLabel="Create"
          onSubmit={create}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
