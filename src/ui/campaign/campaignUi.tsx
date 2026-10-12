import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Encounter } from '@/core/model';
import { CampaignFiles, type CampaignDoc, type CampaignDocKind } from '@/data/campaignFiles';
import type { LoadProblem } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { Field } from '../components/fields';
import { Markdown } from '../components/Markdown';
import { Button, Dialog } from '../kit';

const SAVE_MS = 800;

export interface CampaignTabProps {
  campaignId: string;
  /** The campaign's encounters, newest first, for links. */
  encounters: Encounter[];
}

/** Asks for a name; used for new and renamed campaigns, people, places and quests. */
export function NameDialog(props: {
  title: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { title, initial, confirmLabel, onSubmit, onClose } = props;
  const reportError = useAppStore((s) => s.reportError);
  const [name, setName] = useState(initial);
  const id = useId();
  const valid = name.trim() !== '';
  const submit = () => onSubmit(name.trim()).then(onClose, reportError);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button label={confirmLabel} variant="primary" disabled={!valid} onClick={submit} />
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) submit();
        }}
      >
        <Field label="Name" htmlFor={id}>
          <input id={id} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

/** Files of the campaign that could not be read, so broken files never disappear silently. */
export function Problems({ problems }: { problems: LoadProblem[] }) {
  return problems.map((p) => (
    <div key={p.path} className="error-text">
      {p.path}: {p.message}
    </div>
  ));
}

/** One campaign folder's documents of a kind, with local replace/drop after saves. */
export function useCampaignDocs<T extends CampaignDoc>(campaignId: string, kind: CampaignDocKind<T>) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const files = useMemo(() => new CampaignFiles(repository.storage, campaignId), [repository, campaignId]);
  const [listing, setListing] = useState<{ docs: T[]; problems: LoadProblem[] } | null>(null);

  useEffect(() => {
    files.list(kind).then(setListing, reportError);
  }, [files, kind, reportError]);

  const put = useCallback(
    (doc: T) => setListing((l) => l && { ...l, docs: [...l.docs.filter((d) => d.id !== doc.id), doc] }),
    [],
  );
  const drop = useCallback(
    (id: string) => setListing((l) => l && { ...l, docs: l.docs.filter((d) => d.id !== id) }),
    [],
  );
  return { files, docs: listing?.docs ?? null, problems: listing?.problems ?? [], put, drop };
}

interface NotesEditorProps {
  value: string;
  label: string;
  placeholder: string;
  onCommit: (text: string) => Promise<void>;
}

/**
 * Markdown notes with a Write/Preview switch; saves 800 ms after typing stops, on blur and when it closes.
 * Mount it with a `key` per document so a switch never saves into the wrong file.
 */
export function NotesEditor({ value, label, placeholder, onCommit }: NotesEditorProps) {
  const reportError = useAppStore((s) => s.reportError);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(value.trim() !== '');
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(value);
  const latest = useRef({ draft, committed, onCommit });
  useEffect(() => {
    latest.current = { draft, committed, onCommit };
  });

  const flush = useCallback(() => {
    const { draft: text, committed: stored, onCommit: commit } = latest.current;
    if (text !== stored) {
      latest.current.committed = text;
      setCommitted(text);
      setSaving(true);
      commit(text)
        .catch(reportError)
        .finally(() => setSaving(false));
    }
  }, [reportError]);

  useEffect(() => {
    const timer = window.setTimeout(flush, SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, flush]);
  useEffect(() => flush, [flush]);

  return (
    <div className="notes-editor">
      <div className="row">
        <div className="kit-tabs" role="tablist" aria-label={`${label} view`}>
          <button
            type="button"
            role="tab"
            aria-selected={!preview}
            className={preview ? 'kit-tab' : 'kit-tab active'}
            onClick={() => setPreview(false)}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={preview}
            className={preview ? 'kit-tab active' : 'kit-tab'}
            onClick={() => {
              flush();
              setPreview(true);
            }}
          >
            Preview
          </button>
        </div>
        <div className="spacer" />
        <span className="muted">{saving || draft !== committed ? 'Saving…' : 'Saved'}</span>
      </div>
      {preview ? (
        <div className="notes-preview" onDoubleClick={() => setPreview(false)} title="Double-click to edit">
          <Markdown text={draft} empty={placeholder} />
        </div>
      ) : (
        <textarea
          className="notes-text"
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={flush}
        />
      )}
    </div>
  );
}

interface EncounterLinksProps {
  /** Linked encounter ids, in order. */
  linked: string[];
  encounters: Encounter[];
  onChange: (ids: string[]) => void;
  /** Encounters found without a link (e.g. by name mention), shown without a remove button. */
  mentioned?: string[];
}

/** Chips of linked encounters (Play, unlink) and a picker to link one more. */
export function EncounterLinks({ linked, encounters, onChange, mentioned = [] }: EncounterLinksProps) {
  const reportError = useAppStore((s) => s.reportError);
  const unlinked = encounters.filter((e) => !linked.includes(e.id) && !mentioned.includes(e.id));
  const play = (encounter: Encounter) =>
    useAppStore
      .getState()
      .openEncounter({ campaignId: encounter.campaignId, encounterId: encounter.id })
      .catch(reportError);
  const chip = (id: string, removable: boolean) => {
    const encounter = encounters.find((e) => e.id === id);
    return (
      <span key={id} className="link-chip" title={removable ? undefined : 'Mentioned by name'}>
        <span>{encounter?.name ?? `${id} (deleted)`}</span>
        {encounter && <Button icon="play" label={`Play ${encounter.name}`} iconOnly onClick={() => play(encounter)} />}
        {removable && (
          <Button
            icon="close"
            label="Unlink"
            iconOnly
            variant="ghost"
            onClick={() => onChange(linked.filter((l) => l !== id))}
          />
        )}
      </span>
    );
  };
  return (
    <div className="link-chips">
      {linked.map((id) => chip(id, true))}
      {mentioned.filter((id) => !linked.includes(id)).map((id) => chip(id, false))}
      {unlinked.length > 0 && (
        <select
          aria-label="Link an encounter"
          value=""
          onChange={(e) => e.target.value !== '' && onChange([...linked, e.target.value])}
        >
          <option value="">Link encounter…</option>
          {unlinked.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
