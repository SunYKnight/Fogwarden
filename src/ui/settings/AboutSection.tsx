import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import type { Settings } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useUpdateStore } from '@/state/updateStore';
import { CheckboxField, Field } from '../components/fields';
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

/** Check for updates, the found release's notes and its install; desktop only. */
function Updates({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const status = useUpdateStore((s) => s.status);
  const reportError = useAppStore((s) => s.reportError);
  const busy = status.kind === 'checking' || status.kind === 'installing';
  return (
    <>
      <div className="row">
        <Button
          icon="download"
          label="Check for updates"
          disabled={busy}
          onClick={() => useUpdateStore.getState().check().catch(reportError)}
        />
        {status.kind === 'checking' && <span>Checking…</span>}
        {status.kind === 'current' && <span>Up to date</span>}
        {status.kind === 'installing' && (
          <span>{status.percent === null ? 'Downloading…' : `Downloading… ${status.percent} %`}</span>
        )}
      </div>
      {status.kind === 'failed' && <p className="error-text">{status.message}</p>}
      {status.kind === 'available' && (
        <div className="col">
          <strong>Version {status.version} available</strong>
          {status.notes.length > 0 && <pre className="license-text update-notes">{status.notes}</pre>}
          <div className="row">
            <Button
              icon="download"
              variant="primary"
              label="Install and restart"
              onClick={() => useUpdateStore.getState().install().catch(reportError)}
            />
          </div>
        </div>
      )}
      <CheckboxField
        label="Check on start (once a day)"
        value={settings.updates.autoCheck}
        onChange={(autoCheck) => save({ ...settings, updates: { ...settings.updates, autoCheck } })}
      />
    </>
  );
}

export function AboutSection({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
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
        {isTauri() ? (
          <Updates settings={settings} save={save} />
        ) : (
          <p className="muted">Updates are available in the desktop app only.</p>
        )}
        <p className="muted small">
          The built-in area templates include material from the System Reference Document 5.1 by Wizards of the Coast
          LLC, licensed under CC BY 4.0. Imported packs carry their own attribution.
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
