import { isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { useLanStore, type LanInfo } from '@/state/lanStore';
import { SelectField } from '../components/fields';
import { Button, type ButtonVariant } from '../kit';
import { PlayerLinks } from './PlayerLinks';

/** Party and character links of the running LAN server, for the address the phones can reach. */
export function LanLinks({ info }: { info: LanInfo }) {
  const [chosen, setChosen] = useState('');
  const host = info.hosts.includes(chosen) ? chosen : (info.hosts[0] ?? '');
  return (
    <>
      {info.hosts.length > 1 && <SelectField label="Address" value={host} options={info.hosts} onChange={setChosen} />}
      <PlayerLinks linkOf={(token) => `${host}/player.html?token=${token}`} />
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
