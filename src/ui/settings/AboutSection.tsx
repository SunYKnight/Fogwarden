import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { Field } from '../components/fields';
import { Button, Dialog, Section } from '../kit';
import creatureIconLicense from '../creatureTypes/icons/LICENSE.md?raw';

const LICENSE_FILES = ['packs/srd/LICENSE.md', 'packs/sample-map/LICENSE.md', 'packs/cc0-models/LICENSE.md'];

/** Attribution of the shipped content (read from the content folder) and of the bundled creature type icons. */
function LicenseDialog({ onClose }: { onClose: () => void }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(LICENSE_FILES.map((file) => repository.storage.readText('content', file)))
      .then((texts) => setText([...texts, creatureIconLicense].join('\n\n')))
      .catch(reportError);
  }, [repository, reportError]);
  return (
    <Dialog title="Licenses" onClose={onClose} width={720}>
      {text === null ? <p className="muted">Loading…</p> : <pre className="license-text">{text}</pre>}
    </Dialog>
  );
}

export function AboutSection() {
  const reportError = useAppStore((s) => s.reportError);
  const [version, setVersion] = useState<string | null>(null);
  const [licenses, setLicenses] = useState(false);
  useEffect(() => {
    if (isTauri()) {
      getVersion().then(setVersion, reportError);
    }
  }, [reportError]);

  return (
    <Section title="About">
      <div className="col">
        <Field label="Version">
          <span>{isTauri() ? (version ?? '…') : 'Browser build (version shown in the desktop app)'}</span>
        </Field>
        <Field label="Revision">
          <code>{__GIT_REVISION__}</code>
        </Field>
        <p className="muted small">
          Creatures and area templates include material from the System Reference Document 5.1 by Wizards of the Coast
          LLC, licensed under CC BY 4.0.
        </p>
        <p className="muted small">
          Creature type icons by Lorc and Delapouite from game-icons.net, licensed under CC BY 3.0
          (creativecommons.org/licenses/by/3.0).
        </p>
        <div className="row">
          <Button icon="book" label="Licenses" onClick={() => setLicenses(true)} />
        </div>
      </div>
      {licenses && <LicenseDialog onClose={() => setLicenses(false)} />}
    </Section>
  );
}
