import { useCallback, useEffect, useState } from 'react';
import {
  HISTORY_KIND_LABELS,
  historyDocumentName,
  historyDocuments,
  historyFolderTime,
  restorePlan,
  type HistoryDocument,
  type HistoryKind,
  type HistoryListing,
} from '@/data/history';
import { cleanHistory, listHistory, openHistoryFolder, restoreHistory } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { flushEncounter } from '@/state/autosave';
import { useLibraryStore } from '@/state/libraryStore';
import { SelectField } from '../components/fields';
import { reloadActiveEncounter } from '../encounter/useActiveEncounter';
import { Button, confirmDialog } from '../kit';

interface DocumentView {
  doc: HistoryDocument;
  name: string;
  /** Why the kept file gives no name, e.g. a version the app cannot read. */
  problem: string | null;
}

interface FolderView {
  folder: string;
  heading: string;
  /** Completes "goes back to how it was …". */
  before: string;
  documents: DocumentView[];
}

interface Loaded {
  listing: HistoryListing;
  /** Newest first. */
  folders: FolderView[];
}

const CLEAN_DAYS = ['1', '7', '14'] as const;
type CleanDays = (typeof CLEAN_DAYS)[number];

function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log10(Math.max(bytes, 1)) / 3));
  return power === 0 ? `${bytes} bytes` : `${(bytes / 1000 ** power).toFixed(1)} ${units[power]}`;
}

function folderView(folder: string, documents: DocumentView[]): FolderView {
  const { day, restoredAt } = historyFolderTime(folder);
  const [year, month, date] = day.split('-').map(Number);
  const when = new Date(year!, month! - 1, date!).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return restoredAt
    ? {
        folder,
        heading: `${when}, ${restoredAt}: replaced by a restore`,
        before: `before the restore at ${restoredAt} on ${when}`,
        documents,
      }
    : { folder, heading: when, before: `before the changes of ${when}`, documents };
}

async function loadHistory(): Promise<Loaded> {
  const storage = useAppStore.getState().repository.storage;
  const listing = await listHistory();
  const folders = await Promise.all(
    listing.folders.toReversed().map(async ({ name: folder, files }) => {
      const documents = await Promise.all(
        historyDocuments({ name: folder, files }).map((doc) =>
          historyDocumentName(storage, listing, folder, doc).then(
            (name): DocumentView => ({ doc, name: name ?? doc.id, problem: null }),
            (error: unknown): DocumentView => ({
              doc,
              name: doc.id,
              problem: error instanceof Error ? error.message : String(error),
            }),
          ),
        ),
      );
      return folderView(folder, documents);
    }),
  );
  return { listing, folders };
}

/** Brings every store that holds restored documents up to date. */
async function reloadRestored(kind: HistoryKind): Promise<void> {
  const app = useAppStore.getState();
  if (kind === 'settings') {
    useAppStore.setState({ settings: await app.repository.loadSettings() });
  }
  await useLibraryStore.getState().refreshAll();
  if (kind === 'encounter' || kind === 'map') {
    await reloadActiveEncounter();
  }
}

async function restoreDocument(listing: HistoryListing, folder: FolderView, view: DocumentView): Promise<boolean> {
  const plan = restorePlan(listing, folder.folder, view.doc.key);
  const label = HISTORY_KIND_LABELS[view.doc.kind];
  const ok = await confirmDialog({
    title: `Restore "${view.name}"?`,
    message:
      `${label} "${view.name}" goes back to how it was ${folder.before}: ${plan.length} file(s) are replaced. ` +
      'The current version stays in the history, so you can restore it the same way.',
    confirmLabel: 'Restore',
  });
  if (ok) {
    // A pending autosave of the open encounter would overwrite the restore.
    await flushEncounter();
    await restoreHistory(plan);
    await reloadRestored(view.doc.kind);
    useAppStore.getState().notify(`Restored "${view.name}" as it was ${folder.before}`);
  }
  return ok;
}

/** Settings > Data > History: what the app kept before changing files, restore per document, clean-up. */
export function HistorySection() {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleanDays, setCleanDays] = useState<CleanDays>('7');

  const reload = useCallback(() => loadHistory().then(setLoaded), []);

  useEffect(() => {
    reload().catch(reportError);
  }, [reload, reportError]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    action()
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  const restore = (folder: FolderView, view: DocumentView) =>
    run(async () => {
      if (loaded && (await restoreDocument(loaded.listing, folder, view))) {
        await reload();
      }
    });

  const cleanUp = () =>
    run(async () => {
      const days = Number(cleanDays);
      const ok = await confirmDialog({
        title: 'Clean up the history?',
        message: `Deletes every version kept more than ${days} day(s) ago. They cannot be restored afterwards.`,
        confirmLabel: 'Delete old versions',
        danger: true,
      });
      if (ok) {
        const before = loaded?.listing.bytes ?? 0;
        await cleanHistory(days);
        const after = await loadHistory();
        setLoaded(after);
        notify(`History cleaned up: ${formatBytes(Math.max(0, before - after.listing.bytes))} freed`);
      }
    });

  return (
    <div className="col">
      <h3 className="history-title">History</h3>
      <p className="muted small">
        Before the app changes or deletes a file, it keeps the previous version: the first one each day, for 30 days and
        at most 2 GB (today&apos;s always stay). They are plain files in the history folder.
      </p>
      <div className="row wrap">
        <span className="grow">
          {loaded ? `The history uses ${formatBytes(loaded.listing.bytes)}.` : 'Reading the history…'}
        </span>
        <Button icon="folder" label="Open history folder" onClick={() => openHistoryFolder().catch(reportError)} />
      </div>
      <div className="row wrap">
        <SelectField
          label="Clean up older than"
          value={cleanDays}
          options={CLEAN_DAYS}
          format={(d) => (d === '1' ? '1 day' : `${d} days`)}
          onChange={setCleanDays}
        />
        <Button icon="trash" label="Clean up…" disabled={busy || !loaded} onClick={cleanUp} />
      </div>
      {loaded?.folders.length === 0 && <p className="muted">No changes kept yet.</p>}
      {loaded && loaded.folders.length > 0 && (
        <div className="history-days">
          {loaded.folders.map((folder) => (
            <div key={folder.folder} className="col">
              <div className="list-heading">{folder.heading}</div>
              {folder.documents.map((view) => (
                <div key={view.doc.key} className="history-row">
                  <div className="grow">
                    <div>{view.name}</div>
                    <div className="muted small">
                      {HISTORY_KIND_LABELS[view.doc.kind]} · {view.doc.files.length} file(s),{' '}
                      {formatBytes(view.doc.files.reduce((sum, f) => sum + f.bytes, 0))}
                    </div>
                    {view.problem && <div className="error-text small">Name unreadable: {view.problem}</div>}
                  </div>
                  <Button
                    icon="undo"
                    label="Restore this version"
                    disabled={busy}
                    onClick={() => restore(folder, view)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
