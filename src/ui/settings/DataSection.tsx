import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import type { StorageRoots } from '@/data/storage';
import { copyDataRootTo, openDataRootFolder } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Field } from '../components/fields';
import { Button, confirmDialog, Dialog, Section } from '../kit';
import { HistorySection } from './HistorySection';

/** Loads everything from the new data root and ticks the Home page's "Choose data folder" step there. */
async function switchDataRoot(roots: StorageRoots): Promise<void> {
  const app = useAppStore.getState();
  useAppStore.setState({ roots });
  await app.init();
  await useLibraryStore.getState().refreshAll();
  const settings = useAppStore.getState().settings;
  if (settings) {
    const done = { ...settings.onboarding.done, dataFolder: true };
    await app.setSettings({ ...settings, onboarding: { ...settings.onboarding, done } });
  }
  app.notify(`Data folder: ${roots.dataRoot}`);
}

async function chooseFolder(current: string): Promise<void> {
  const picked = await open({ directory: true, title: 'Choose the data folder', defaultPath: current });
  const ok =
    picked !== null &&
    (await confirmDialog({
      title: 'Use this data folder?',
      message:
        `From now on maps, creatures, campaigns and settings are read from and saved in ${picked}. ` +
        `Nothing is copied: your data in ${current} stays there. To take it along, use "Copy my data" instead.`,
      confirmLabel: 'Use folder',
    }));
  if (picked !== null && ok) {
    await switchDataRoot(await useAppStore.getState().repository.storage.setDataRoot(picked));
  }
}

async function copyToNewFolder(current: string): Promise<void> {
  const picked = await open({ directory: true, title: 'Choose an empty folder for the copy' });
  const ok =
    picked !== null &&
    (await confirmDialog({
      title: 'Copy your data?',
      message:
        `Everything in ${current} is copied to ${picked}, which must be empty, and the app then works with ` +
        'the copy. The original folder stays unchanged.',
      confirmLabel: 'Copy and switch',
    }));
  if (picked !== null && ok) {
    await switchDataRoot(await copyDataRootTo(picked));
  }
}

/** Where the user's data lives: pick, open or copy the folder without typing a path. */
export function DataSection() {
  const roots = useAppStore((s) => s.roots);
  const reportError = useAppStore((s) => s.reportError);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const desktop = isTauri();

  const run = (action: (current: string) => Promise<void>) => {
    setBusy(true);
    action(roots?.dataRoot ?? '')
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  return (
    <Section title="Data">
      <div className="col">
        <Field label="Data folder">
          <code className="settings-path">{roots?.dataRoot}</code>
        </Field>
        {desktop ? (
          <div className="row wrap">
            <Button icon="folder" label="Choose folder…" disabled={busy} onClick={() => run(chooseFolder)} />
            <Button icon="external" label="Open folder" onClick={() => openDataRootFolder().catch(reportError)} />
            <Button
              icon="copy"
              label="Copy my data to a new folder…"
              disabled={busy}
              onClick={() => run(copyToNewFolder)}
            />
            <Button icon="clock" label="Version history…" onClick={() => setHistory(true)} />
          </div>
        ) : (
          <p className="muted">
            In the browser your data stays in this browser's storage. Choosing, opening and copying a data folder needs
            the desktop app.
          </p>
        )}
        <p className="muted small">
          Put the data folder in a synced folder (e.g. Dropbox) to use it on several computers. Shipped SRD content is
          read from <code>{roots?.contentRoot}</code>.
        </p>
        {history && (
          <Dialog title="Version history" width={720} onClose={() => setHistory(false)}>
            <HistorySection />
          </Dialog>
        )}
      </div>
    </Section>
  );
}
