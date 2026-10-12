import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import type { RemoteSettings } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useRelayStore, type RelayLink } from '@/state/relayStore';
import { RELAY_LINK_PARAM } from '@/sync/relayApi';
import { testRelay } from '@/sync/relayClient';
import { NumberField, TextField } from '../components/fields';
import { Button, PageHeader, Section } from '../kit';
import { LanControls } from '../shell/LanControls';
import { PlayerLinks } from '../shell/PlayerLinks';
import { DeployDialog } from './DeployDialog';
import { saveRemote, type ServerSetup } from './remoteSettings';

const LINK_TEXT: Record<RelayLink, string> = {
  off: 'Not connected',
  connecting: 'Connecting…',
  online: 'Connected',
  reconnecting: 'Connection lost, reconnecting…',
};

function RemoteSection({ remote }: { remote: RemoteSettings }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const { link, players, baseUrl, lastError } = useRelayStore();
  const [testing, setTesting] = useState(false);
  const ready = remote.url.trim() !== '' && remote.dmKey.trim() !== '';
  const connected = link !== 'off';

  const test = () => {
    setTesting(true);
    testRelay(remote.url, remote.dmKey)
      .then(
        (session) => notify(`Server reachable and DM key accepted; ${session.players} players connected`, 'info'),
        reportError,
      )
      .finally(() => setTesting(false));
  };

  return (
    <Section title="Remote server">
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
      <TextField
        label="DM key"
        value={remote.dmKey}
        secret
        onChange={(dmKey) => saveRemote((r) => ({ ...r, dmKey })).catch(reportError)}
      />
      {isTauri() ? (
        <div className="row">
          {connected ? (
            <Button
              icon="close"
              label="Disconnect"
              variant="danger"
              onClick={() => useRelayStore.getState().disconnect()}
            />
          ) : (
            <Button
              icon="server"
              label="Connect"
              variant="primary"
              disabled={!ready}
              onClick={() => useRelayStore.getState().connect(remote.url, remote.dmKey).catch(reportError)}
            />
          )}
          <Button icon="check" label="Test connection" disabled={!ready || testing} onClick={test} />
        </div>
      ) : (
        <p className="muted small">Connecting needs the desktop app: it uploads the built player page.</p>
      )}
      <p className="small" role="status">
        {LINK_TEXT[link]}
        {link === 'online' && ` · ${players} ${players === 1 ? 'player' : 'players'}`}
      </p>
      {lastError && <p className="error-text small">{lastError}</p>}
      {baseUrl && <PlayerLinks linkOf={(token) => `${baseUrl}/?${RELAY_LINK_PARAM}=${token}`} />}
    </Section>
  );
}

async function downloadInstallFiles(setup: ServerSetup): Promise<string | null> {
  const folder = await open({ directory: true, title: 'Folder for install.sh, the nginx site and relay.mjs' });
  const written = folder === null ? null : await invoke<string[]>('deploy_write_files', { folder, setup });
  return written === null ? null : `Wrote ${written.length} files to ${folder}`;
}

function SetupSection({ remote }: { remote: RemoteSettings }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [deploying, setDeploying] = useState(false);
  const { setup } = remote;
  const saveSetup = (change: Partial<ServerSetup>) =>
    saveRemote((r) => ({ ...r, setup: { ...r.setup, ...change } })).catch(reportError);
  const ready = isTauri() && setup.domain.trim() !== '';

  return (
    <Section title="Set up a server">
      <p className="muted small">
        For an Ubuntu 22.04 or 24.04 server whose DNS name points to it, with ports 80 and 443 open. The install script
        sets up Node.js, nginx, the relay service and, given an email, a Let&apos;s Encrypt certificate. Run it again to
        update; the DM key stays.
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
      <div className="row">
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
      </div>
      {!isTauri() && <p className="muted small">Setting up a server needs the desktop app.</p>}
      {deploying && <DeployDialog remote={remote} onClose={() => setDeploying(false)} />}
    </Section>
  );
}

/** LAN server, internet relay connection and relay installation in one place. */
export function ServerPage() {
  const remote = useAppStore((s) => s.settings?.remote ?? null);
  const link = useRelayStore((s) => s.link);

  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Server' }]} status={link === 'off' ? undefined : LINK_TEXT[link]} />
      <div className="page-body">
        {remote ? (
          <div className="settings-page">
            <Section title="Local network">
              <LanControls />
            </Section>
            <RemoteSection remote={remote} />
            <SetupSection remote={remote} />
          </div>
        ) : (
          <div className="waiting">Loading settings…</div>
        )}
      </div>
    </div>
  );
}
