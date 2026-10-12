import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { Field } from '../components/fields';
import { Button, Dialog, Section } from '../kit';
import appLicense from '../../../LICENSE?raw';
import thirdPartyNotices from '../../../THIRD_PARTY_NOTICES.md?raw';

/** The app's own license and the notices for shipped content and dependencies, bundled at build time. */
function LicenseDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Licenses" onClose={onClose} width={720}>
      <pre className="license-text">{`${appLicense}\n${thirdPartyNotices}`}</pre>
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
        <p>
          Fogwarden, released under the MIT License. Source: <code>https://github.com/SunYKnight/Fogwarden</code>
        </p>
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
