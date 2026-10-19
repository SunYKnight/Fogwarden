import { isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import type { DmRemote } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useLanStore, type LanInfo } from '@/state/lanStore';
import { CheckboxField, SelectField } from '../components/fields';
import { Button, confirmDialog, type ButtonVariant } from '../kit';
import { PlayerLinks, QrCode } from './PlayerLinks';

/**
 * The DM link: a second device of the DM (a laptop at the table) opens it in a browser and gets the full DM app,
 * controlling this one. Off until turned on; New link makes the old one stop working.
 */
function DmLink({ host }: { host: string }) {
  const dmRemote = useAppStore((s) => s.settings?.dmRemote ?? null);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const token = useLanStore((s) => s.dmToken);
  const url = token === null ? null : `${host}/dm.html?token=${token}`;

  const change = (next: DmRemote) => {
    const { settings, setSettings } = useAppStore.getState();
    if (settings) setSettings({ ...settings, dmRemote: next }).catch(reportError);
  };

  const replace = async () => {
    const ok = await confirmDialog({
      title: 'New DM link',
      message: 'The current DM link stops working at once; a device that uses it needs the new one.',
      confirmLabel: 'New link',
      danger: true,
    });
    if (ok && dmRemote) change({ ...dmRemote, rotation: dmRemote.rotation + 1 });
  };

  return (
    dmRemote && (
      <div className="col dm-link">
        <div className="row player-links-head">
          <CheckboxField
            label="DM link for my laptop"
            value={dmRemote.enabled}
            onChange={(enabled) => change({ ...dmRemote, enabled })}
          />
          {dmRemote.enabled && (
            <Button icon="undo" label="New link" onClick={() => void replace().catch(reportError)} />
          )}
        </div>
        {dmRemote.enabled && url === null && <p className="muted small">Preparing the DM link…</p>}
        {url !== null && (
          <>
            <div className="row">
              <code className="grow small lan-url">{url}</code>
              <Button
                icon="copy"
                label="Copy DM link"
                iconOnly
                variant="ghost"
                onClick={() =>
                  navigator.clipboard.writeText(url).then(() => notify('DM link copied', 'success'), reportError)
                }
              />
            </div>
            <QrCode text={url} />
            <p className="muted small">
              Whoever opens this link controls this app like you do: keep it to your own devices. This computer stays in
              charge and keeps the files, the player view and the sound.
            </p>
          </>
        )}
      </div>
    )
  );
}

/** Party and character links of the running LAN server, for the address the phones can reach, and the DM link. */
export function LanLinks({ info }: { info: LanInfo }) {
  const [chosen, setChosen] = useState('');
  const host = info.hosts.includes(chosen) ? chosen : (info.hosts[0] ?? '');
  return (
    <>
      {info.hosts.length > 1 && <SelectField label="Address" value={host} options={info.hosts} onChange={setChosen} />}
      <PlayerLinks linkOf={(token) => `${host}/player.html?token=${token}`} />
      <DmLink host={host} />
    </>
  );
}

/** Starts the LAN server on the port from the settings, or stops it while it runs. */
export function LanButton({ variant }: { variant: ButtonVariant }) {
  const port = useAppStore((s) => s.settings?.lan.port ?? null);
  const reportError = useAppStore((s) => s.reportError);
  const running = useLanStore((s) => s.info !== null);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    action()
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  return running ? (
    <Button
      icon="close"
      label="Stop LAN"
      variant="danger"
      disabled={busy}
      onClick={() => run(() => useLanStore.getState().stop())}
    />
  ) : (
    <Button
      icon="wifi"
      label="Start LAN"
      variant={variant}
      title={port === null ? undefined : `On port ${port}`}
      disabled={busy || port === null}
      onClick={() => run(() => (port === null ? Promise.resolve() : useLanStore.getState().start(port)))}
    />
  );
}

/** Starts the LAN server so phones and tablets on the same network open the player view in a browser. */
export function LanControls() {
  const info = useLanStore((s) => s.info);

  return !isTauri() ? (
    <p className="muted small">The LAN server needs the desktop app.</p>
  ) : (
    <div className="col">
      {info && <LanLinks info={info} />}
      <div className="row">
        <LanButton variant="primary" />
      </div>
      <p className="muted small">
        Phones and tablets on the same network open a link or scan the code: the party link shows what all characters
        see, a character's link only what that character sees. Links stay valid until replaced; Windows may ask to allow
        the app through the firewall.
      </p>
    </div>
  );
}
