import { open } from '@tauri-apps/plugin-dialog';
import { useMemo, useState } from 'react';
import { matchPortraits } from '@/core/import/portraitMatch';
import { creaturePictureRef, type LibraryEntry } from '@/data/repository';
import { importFile, listFolder } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField } from '../components/fields';
import { Button, Dialog } from '../kit';
import { closeCompendiumDialog, useCompendiumDialogStore } from './compendiumUi';

type Entry = LibraryEntry<'creature'>;

interface PlannedPortrait {
  fileName: string;
  entry: Entry;
  /** The creature already has an image this file would replace. */
  replaces: boolean;
}

/** Asks for a folder of creature pictures and shows which creatures they fit before anything is copied. */
export async function attachPortraitsFromFolder(): Promise<void> {
  const folder = await open({ directory: true, title: 'Choose a folder with creature pictures' });
  if (folder !== null) {
    const files = (await listFolder(folder)).filter((e) => !e.isDir).map((e) => e.name);
    useCompendiumDialogStore.setState({ dialog: { kind: 'attach-portraits', folder, files } });
  }
}

// The copy's file name attaches it, also to shipped creatures, whose text
// files stay untouched.
async function attach(folder: string, plan: PlannedPortrait[]): Promise<void> {
  const { repository } = useAppStore.getState();
  const base = folder.replace(/[\\/]+$/, '');
  for (const { fileName, entry } of plan) {
    const image = creaturePictureRef('data', entry.ref.id, 'image', fileName.slice(fileName.lastIndexOf('.') + 1));
    await importFile(`${base}/${fileName}`, image.path);
    await repository.storeCreaturePictures(entry.ref.id, { image, token: entry.doc.token });
  }
  await useLibraryStore.getState().refresh('creature');
  useAppStore.getState().notify(`Attached ${plan.length} portraits`);
}

export function AttachPortraitsDialog({ folder, files }: { folder: string; files: string[] }) {
  const reportError = useAppStore((s) => s.reportError);
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  const matching = useMemo(
    () =>
      matchPortraits(
        files,
        entries.map((e) => ({ id: e.ref.id, name: e.doc.name })),
      ),
    [files, entries],
  );
  const planned = useMemo(
    () =>
      matching.matches.flatMap(({ fileName, creatureId }) => {
        const entry = entries.find((e) => e.ref.id === creatureId);
        return entry ? [{ fileName, entry, replaces: entry.doc.image !== null }] : [];
      }),
    [matching, entries],
  );
  const existing = planned.filter((p) => p.replaces).length;
  const plan = planned.filter((p) => replace || !p.replaces);

  const apply = async () => {
    setBusy(true);
    try {
      await attach(folder, plan);
      closeCompendiumDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Attach portraits from folder"
      onClose={closeCompendiumDialog}
      width={640}
      footer={
        <>
          <Button label="Cancel" onClick={closeCompendiumDialog} />
          <Button
            icon="image"
            label={`Attach ${plan.length} portraits`}
            variant="primary"
            disabled={plan.length === 0 || busy}
            onClick={() => apply().catch(reportError)}
          />
        </>
      }
    >
      <div className="col portrait-attach">
        <p className="muted portrait-folder">{folder}</p>
        <p>
          <strong>{planned.length}</strong> creatures matched. Pictures are matched by creature name or id; case,
          accents, punctuation and prefixes such as "legacy--" don't matter.
        </p>
        {existing > 0 && (
          <CheckboxField
            label={`Replace the image of ${existing} creatures that already have one`}
            value={replace}
            onChange={setReplace}
          />
        )}
        <ul className="portrait-list" aria-label="Matched pictures">
          {planned.map((p) => (
            <li key={p.entry.ref.id}>
              <span className="row-name">{p.entry.doc.name}</span>
              <span className="muted">{p.fileName}</span>
              {p.replaces && <span className="badge">{replace ? 'replaces image' : 'keeps image'}</span>}
            </li>
          ))}
        </ul>
        {matching.unmatched.length > 0 && (
          <details>
            <summary>{matching.unmatched.length} pictures without a matching creature</summary>
            <ul className="portrait-list">
              {matching.unmatched.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        )}
        {matching.duplicates.length > 0 && (
          <details>
            <summary>{matching.duplicates.length} pictures skipped: another picture fits the same creatures</summary>
            <ul className="portrait-list">
              {matching.duplicates.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Dialog>
  );
}
