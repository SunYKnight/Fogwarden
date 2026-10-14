import { open } from '@tauri-apps/plugin-dialog';
import { useMemo, useState } from 'react';
import { matchPortraits } from '@/core/import/portraitMatch';
import { countOf } from '@/core/plural';
import { downloadApiPictures, listApiPictures } from '@/data/dnd5eapiPictures';
import { MY_CONTENT_SOURCE } from '@/data/packs';
import { creaturePictureRef, type LibraryEntry } from '@/data/repository';
import { importFile, listFolder } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField } from '../components/fields';
import { Button, Dialog } from '../kit';
import { closeCompendiumDialog, useCompendiumDialogStore, type PortraitSource } from './compendiumUi';

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
    useCompendiumDialogStore.setState({
      dialog: { kind: 'attach-portraits', source: { kind: 'folder', folder }, files },
    });
  }
}

/** Asks the D&D 5e API which monster pictures it has and shows which creatures they fit. */
export async function attachPortraitsFromApi(): Promise<void> {
  const files = await listApiPictures();
  useCompendiumDialogStore.setState({ dialog: { kind: 'attach-portraits', source: { kind: 'api' }, files } });
}

// The copy's file name in My content attaches it, also to pack creatures,
// whose text files stay untouched.
async function attachFromFolder(folder: string, plan: PlannedPortrait[]): Promise<void> {
  const { repository } = useAppStore.getState();
  const base = folder.replace(/[\\/]+$/, '');
  for (const { fileName, entry } of plan) {
    const extension = fileName.slice(fileName.lastIndexOf('.') + 1);
    const image = creaturePictureRef(MY_CONTENT_SOURCE, entry.ref.id, 'image', extension);
    await importFile(`${base}/${fileName}`, image.path);
    await repository.storeCreaturePictures(entry.ref.id, { image, token: entry.doc.token });
  }
}

async function attach(source: PortraitSource, plan: PlannedPortrait[], onProgress: (done: number) => void) {
  const { repository, notify } = useAppStore.getState();
  const lacking =
    source.kind === 'folder'
      ? await attachFromFolder(source.folder, plan).then(() => [])
      : await downloadApiPictures(
          repository,
          plan.map((p) => ({ creatureId: p.entry.ref.id, fileName: p.fileName })),
          onProgress,
        );
  await useLibraryStore.getState().refresh('creature');
  const missed = lacking.length > 0 ? `; the API had no picture for ${lacking.length}` : '';
  notify(`Attached ${countOf(plan.length - lacking.length, 'picture')}${missed}`);
}

const SOURCE_TEXT: Record<PortraitSource['kind'], { title: string; intro: string }> = {
  folder: {
    title: 'Attach portraits from folder',
    intro:
      'Pictures are matched by creature name or id; case, accents, punctuation and prefixes such as ' +
      '"homebrew--" don\'t matter.',
  },
  api: {
    title: 'Download pictures from the D&D 5e API',
    intro:
      'dnd5eapi.co has one painted picture per SRD 5.1 monster, for your own use; they are matched to the ' +
      'SRD monsters in your library (imported from the D&D 5e API), downloaded (about 1.7 MB each), shrunk to ' +
      '768 px and saved in My content on this computer.',
  },
};

export function AttachPortraitsDialog({ source, files }: { source: PortraitSource; files: string[] }) {
  const reportError = useAppStore((s) => s.reportError);
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

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
  const text = SOURCE_TEXT[source.kind];
  const busy = progress !== null;
  const action = source.kind === 'api' ? 'Download' : 'Attach';

  const apply = async () => {
    setProgress(0);
    try {
      await attach(source, plan, setProgress);
      closeCompendiumDialog();
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog
      title={text.title}
      onClose={() => {
        // The job keeps running; its final close would hit the next dialog.
        if (!busy) closeCompendiumDialog();
      }}
      width={640}
      footer={
        <>
          {busy && source.kind === 'api' && (
            <span className="muted grow">
              {progress} of {plan.length} downloaded…
            </span>
          )}
          <Button label="Cancel" onClick={closeCompendiumDialog} disabled={busy} />
          <Button
            icon={source.kind === 'api' ? 'download' : 'image'}
            label={`${action} ${countOf(plan.length, 'picture')}`}
            variant="primary"
            disabled={plan.length === 0 || busy}
            onClick={() => apply().catch(reportError)}
          />
        </>
      }
    >
      <div className="col portrait-attach">
        {source.kind === 'folder' && <p className="muted portrait-folder">{source.folder}</p>}
        <p>
          <strong>{countOf(planned.length, 'creature')}</strong> matched. {text.intro}
        </p>
        {existing > 0 && (
          <CheckboxField
            label={`Replace the existing image (${countOf(existing, 'creature')})`}
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
            <summary>{countOf(matching.unmatched.length, 'picture')} without a matching creature</summary>
            <ul className="portrait-list">
              {matching.unmatched.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        )}
        {matching.duplicates.length > 0 && (
          <details>
            <summary>
              {countOf(matching.duplicates.length, 'picture')} skipped: another picture fits the same creatures
            </summary>
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
