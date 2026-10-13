import { Channel, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from 'react';
import type { RemoteSettings } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useRelayStore } from '@/state/relayStore';
import { NumberField, TextField } from '../components/fields';
import { Button, confirmDialog, Dialog } from '../kit';
import { saveRemote, type ServerSetup } from './remoteSettings';

/** Mirrors `DeployLine` in `src-tauri/src/deploy.rs`. */
interface DeployLine {
  stream: 'info' | 'stdout' | 'stderr';
  line: string;
}

type DeployAuth = { kind: 'key'; path: string; passphrase: string | null } | { kind: 'password'; password: string };

interface DeployRequest {
  host: string;
  port: number;
  user: string;
  auth: DeployAuth;
  fingerprint: string;
  setup: ServerSetup;
}

type Phase = 'form' | 'running' | 'done';

/**
 * Trust on first use, like OpenSSH: a new host asks once, a changed key warns. True when the user trusts
 * `fingerprint`; a newly trusted key is stored.
 */
async function trustHostKey(remote: RemoteSettings, hostId: string, fingerprint: string): Promise<boolean> {
  const known = remote.knownHosts[hostId];
  const trusted =
    known === fingerprint ||
    (await confirmDialog(
      known === undefined
        ? {
            title: 'Trust this server?',
            message:
              `First connection to ${hostId}. Its host key fingerprint is ${fingerprint}. Compare it with the ` +
              'one your hosting provider shows, or run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on ' +
              'the server, before you continue.',
            confirmLabel: 'Trust and deploy',
          }
        : {
            title: 'Server key changed',
            message:
              `The host key of ${hostId} changed from ${known} to ${fingerprint}. That happens when the server ` +
              'was reinstalled, or when someone intercepts the connection. Only continue if you know why.',
            confirmLabel: 'Trust the new key',
            danger: true,
          },
    ));
  if (trusted && known !== fingerprint) {
    await saveRemote((r) => ({ ...r, knownHosts: { ...r.knownHosts, [hostId]: fingerprint } }));
  }
  return trusted;
}

/** Uploads and runs the install script over SSH, streaming its output, and fills in the remote settings. */
export function DeployDialog({ remote, onClose }: { remote: RemoteSettings; onClose: () => void }) {
  const reportError = useAppStore((s) => s.reportError);
  const [host, setHost] = useState(remote.ssh.host || remote.setup.domain);
  const [port, setPort] = useState(remote.ssh.port);
  const [user, setUser] = useState(remote.ssh.user);
  const [keyPath, setKeyPath] = useState(remote.ssh.keyPath);
  const [usePassword, setUsePassword] = useState(remote.ssh.keyPath === null);
  // Secrets live in this dialog only and are never saved.
  const [secret, setSecret] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [log, setLog] = useState<DeployLine[]>([]);
  const [dmKey, setDmKey] = useState<string | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const ready = host.trim() !== '' && user.trim() !== '' && (usePassword ? secret !== '' : keyPath !== null);

  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [log.length]);

  const chooseLogin = (password: boolean) => {
    setUsePassword(password);
    setSecret('');
  };

  const pickKey = () =>
    open({ title: 'Private SSH key file' }).then((picked) => picked !== null && setKeyPath(picked), reportError);

  const deploy = async () => {
    const hostId = `${host}:${port}`;
    const fingerprint = await invoke<string>('deploy_host_key', { host, port });
    const trusted = await trustHostKey(remote, hostId, fingerprint);
    if (trusted) {
      await saveRemote((r) => ({ ...r, ssh: { host, port, user, keyPath: usePassword ? null : keyPath } }));
      setLog([]);
      setPhase('running');
      const events = new Channel<DeployLine>();
      events.onmessage = (line) => setLog((lines) => [...lines, line]);
      const auth: DeployAuth = usePassword
        ? { kind: 'password', password: secret }
        : { kind: 'key', path: keyPath ?? '', passphrase: secret === '' ? null : secret };
      const request: DeployRequest = { host, port, user, auth, fingerprint, setup: remote.setup };
      const result = await invoke<{ dmKey: string }>('deploy_run', { request, events });
      await saveRemote((r) => ({ ...r, url: `https://${remote.setup.domain}`, dmKey: result.dmKey }));
      setDmKey(result.dmKey);
      setPhase('done');
    }
  };

  const start = () =>
    deploy().catch((error: unknown) => {
      setPhase('form');
      reportError(error);
    });

  const connect = () => {
    const { url, dmKey: key } = useAppStore.getState().settings?.remote ?? { url: '', dmKey: '' };
    useRelayStore.getState().connect(url, key).catch(reportError);
    onClose();
  };

  return (
    <Dialog
      title={`Deploy to ${remote.setup.domain}`}
      width={720}
      onClose={phase === 'running' ? () => undefined : onClose}
      footer={
        phase === 'done' ? (
          <>
            <Button label="Close" onClick={onClose} />
            <Button icon="server" label="Connect now" variant="primary" onClick={connect} />
          </>
        ) : (
          <>
            <Button label="Cancel" disabled={phase === 'running'} onClick={onClose} />
            <Button
              icon="upload"
              label={phase === 'running' ? 'Deploying…' : 'Deploy'}
              variant="primary"
              disabled={!ready || phase === 'running'}
              onClick={start}
            />
          </>
        )
      }
    >
      <div className="col">
        <div className="deploy-target">
          <TextField label="Host" value={host} placeholder={remote.setup.domain} onChange={setHost} />
          <NumberField label="SSH port" value={port} min={1} max={65535} onChange={setPort} />
          <TextField label="User" value={user} onChange={setUser} />
        </div>
        <div className="segmented" role="group" aria-label="Login">
          <Button icon="lock" label="Key file" active={!usePassword} onClick={() => chooseLogin(false)} />
          <Button icon="user" label="Password" active={usePassword} onClick={() => chooseLogin(true)} />
        </div>
        {usePassword ? (
          <TextField label="Password" value={secret} secret onChange={setSecret} />
        ) : (
          <>
            <div className="row">
              <code className="grow small settings-path">{keyPath ?? 'No key file chosen'}</code>
              <Button icon="folder" label="Choose key file…" onClick={pickKey} />
            </div>
            <TextField label="Key passphrase (if any)" value={secret} secret onChange={setSecret} />
          </>
        )}
        <p className="muted small">
          The user must be root or may use sudo. The password is used for this deploy only and never saved.
        </p>
        {log.length > 0 && (
          <div className="deploy-log" role="log" aria-label="Deploy output">
            {log.map((entry, index) => (
              <div key={index} className={`deploy-line ${entry.stream}`}>
                {entry.line}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        )}
        {dmKey && (
          <p className="small">
            Done. DM key: <code className="settings-path">{dmKey}</code> (saved under Settings &gt; Players &gt;
            Online).
          </p>
        )}
      </div>
    </Dialog>
  );
}
