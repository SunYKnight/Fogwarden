import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import type { RemoteSettings } from '@/core/model';
import { countOf } from '@/core/plural';
import { useAppStore } from '@/state/appStore';
import { useRelayStore, type RelayLink } from '@/state/relayStore';
import { RELAY_LINK_PARAM } from '@/sync/relayApi';
import { testRelay } from '@/sync/relayClient';
import { NumberField, TextField } from '../components/fields';
import { Button, Dialog, Section, type ButtonVariant } from '../kit';
import { PlayerLinks } from '../shell/PlayerLinks';
import { DeployDialog } from './DeployDialog';
import { saveRemote, type ServerSetup } from './remoteSettings';

export const LINK_TEXT: Record<RelayLink, string> = {
  off: 'Not connected',
  connecting: 'Connecting…',
  online: 'Connected',
  reconnecting: 'Connection lost, reconnecting…',
};

/** Connect to the relay server in the settings, or disconnect while a connection is up. */
export function RelayButton({ remote, variant }: { remote: RemoteSettings; variant: ButtonVariant }) {
  const reportError = useAppStore((s) => s.reportError);
  const connected = useRelayStore((s) => s.link !== 'off');
  const ready = remote.url.trim() !== '' && remote.dmKey.trim() !== '';
  return connected ? (
    <Button icon="close" label="Disconnect" variant="danger" onClick={() => useRelayStore.getState().disconnect()} />
  ) : (
    <Button
      icon="server"
      label="Connect"
      variant={variant}
      disabled={!ready}
      title={ready ? undefined : 'Enter the server URL and DM key in Settings > Players'}
      onClick={() => useRelayStore.getState().connect(remote.url, remote.dmKey).catch(reportError)}
    />
  );
}

async function downloadInstallFiles(setup: ServerSetup): Promise<string | null> {
  const folder = await open({ directory: true, title: 'Folder for install.sh, the nginx site and relay.mjs' });
  const written = folder === null ? null : await invoke<string[]>('deploy_write_files', { folder, setup });
  return written === null ? null : `Wrote ${written.length} files to ${folder}`;
}

/** One-time installation of the relay on an own server: install files to download or a deploy via SSH. */
function ServerSetupDialog({ remote, onClose }: { remote: RemoteSettings; onClose: () => void }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [deploying, setDeploying] = useState(false);
  const { setup } = remote;
  const saveSetup = (change: Partial<ServerSetup>) =>
    saveRemote((r) => ({ ...r, setup: { ...r.setup, ...change } })).catch(reportError);
  const ready = isTauri() && setup.domain.trim() !== '';

  return (
    <Dialog
      title="Set up a server"
      width={600}
      onClose={onClose}
      footer={
        <>
          <Button label="Close" onClick={onClose} />
          <Button
            icon="folder"
            label="Download install script"
            disabled={!ready}
            onClick={() => downloadInstallFiles(setup).then((done) => done && notify(done), reportError)}
          />
          <Button
            icon="upload"
            label="Deploy via SSH…"
            variant="primary"
            disabled={!ready}
            onClick={() => setDeploying(true)}
          />
        </>
      }
    >
      <div className="col">
        <p className="muted small">
          For an Ubuntu 22.04 or 24.04 server whose DNS name points to it, with ports 80 and 443 open. The install
          script sets up Node.js, nginx, the relay service and, given an email, a Let&apos;s Encrypt certificate. On a
          server run by nginx-manager it registers a site there and leaves nginx to it. Run it again to update; the DM
          key stays.
        </p>
        <TextField
          label="Domain"
          value={setup.domain}
          placeholder="fogwarden.example.org"
          onChange={(domain) => saveSetup({ domain: domain.trim().toLowerCase() })}
        />
        <TextField
          label="Email for Let's Encrypt"
          value={setup.email}
          placeholder="Empty: no certificate, set up TLS yourself"
          onChange={(email) => saveSetup({ email: email.trim() })}
        />
        <NumberField
          label="Relay port on the server"
          value={setup.appPort}
          min={1024}
          max={65535}
          title="Local port behind nginx; only nginx talks to it"
          onChange={(appPort) => saveSetup({ appPort })}
        />
        {!isTauri() && <p className="muted small">Setting up a server needs the desktop app.</p>}
      </div>
      {deploying && <DeployDialog remote={remote} onClose={() => setDeploying(false)} />}
    </Dialog>
  );
}

/** Settings > Players > Online: the relay server players reach over the internet. */
export function OnlineSection({ remote }: { remote: RemoteSettings }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const link = useRelayStore((s) => s.link);
  const players = useRelayStore((s) => s.players);
  const baseUrl = useRelayStore((s) => s.baseUrl);
  const lastError = useRelayStore((s) => s.lastError);
  const [testing, setTesting] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  // The DM key travels with every request; plain http would expose it.
  const insecure = remote.url.trim() !== '' && !remote.url.trim().startsWith('https://');
  const ready = remote.url.trim() !== '' && remote.dmKey.trim() !== '' && !insecure;

  const test = () => {
    setTesting(true);
    testRelay(remote.url, remote.dmKey)
      .then(
        (session) =>
          notify(`Server reachable and DM key accepted; ${countOf(session.players, 'player')} connected`, 'info'),
        reportError,
      )
      .finally(() => setTesting(false));
  };

  return (
    <Section title="Online">
      <p className="muted small">
        Players anywhere open the link in a browser. The app sends the relay only what players may see, plus the map
        images, tokens and models they need.
      </p>
      <TextField
        label="Server URL"
        value={remote.url}
        placeholder="https://fogwarden.example.org"
        onChange={(url) => saveRemote((r) => ({ ...r, url })).catch(reportError)}
      />
      {insecure && <p className="error-text small">The server URL has to start with https://.</p>}
      <TextField
        label="DM key"
        value={remote.dmKey}
        secret
        onChange={(dmKey) => saveRemote((r) => ({ ...r, dmKey })).catch(reportError)}
      />
      {isTauri() ? (
        <div className="row wrap">
          <RelayButton remote={remote} variant="primary" />
          <Button icon="check" label="Test connection" disabled={!ready || testing} onClick={test} />
          <Button icon="server" label="Set up a server…" variant="ghost" onClick={() => setSettingUp(true)} />
        </div>
      ) : (
        <p className="muted small">Connecting needs the desktop app: it uploads the built player page.</p>
      )}
      <p className="small" role="status">
        {LINK_TEXT[link]}
        {link === 'online' && ` · ${countOf(players, 'player')}`}
      </p>
      {lastError && <p className="error-text small">{lastError}</p>}
      {baseUrl && <PlayerLinks linkOf={(token) => `${baseUrl}/?${RELAY_LINK_PARAM}=${token}`} />}
      {settingUp && <ServerSetupDialog remote={remote} onClose={() => setSettingUp(false)} />}
    </Section>
  );
}
