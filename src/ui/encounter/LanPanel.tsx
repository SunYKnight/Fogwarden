import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { encode } from 'uqr';
import { useAppStore } from '@/state/appStore';
import { useLanStore, type LanInfo } from '@/state/lanStore';
import { NumberField } from '../components/fields';

function QrCode({ text }: { text: string }) {
  // Four modules of quiet zone: phone scanners miss codes with less.
  const { size, data } = useMemo(() => encode(text, { ecc: 'M', border: 4 }), [text]);
  const path = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join('');
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={text}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const reportError = useAppStore((s) => s.reportError);
  return <button onClick={() => navigator.clipboard.writeText(text).catch(reportError)}>Copy</button>;
}

function RunningServer({ info }: { info: LanInfo }) {
  const [selected, setSelected] = useState(0);
  const qrUrl = info.urls[Math.min(selected, info.urls.length - 1)] ?? '';
  return (
    <>
      <span>
        Players connected: <strong>{info.players}</strong>
      </span>
      {info.urls.map((url, index) => (
        <div key={url} className="row">
          <input type="radio" checked={url === qrUrl} onChange={() => setSelected(index)} title="Show as QR code" />
          <code className="grow small lan-url">{url}</code>
          <CopyButton text={url} />
        </div>
      ))}
      <QrCode text={qrUrl} />
      <div className="row">
        <span className="muted">Token</span>
        <code className="grow small lan-url">{info.token}</code>
        <CopyButton text={info.token} />
      </div>
    </>
  );
}

/** Starts the LAN server so phones and tablets on the same network open the player view in a browser. */
export function LanPanel() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const reportError = useAppStore((s) => s.reportError);
  const info = useLanStore((s) => s.info);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    useLanStore.getState().refresh().catch(reportError);
  }, [reportError]);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    action()
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  return !isTauri() ? (
    <span className="muted">The LAN server needs the desktop app.</span>
  ) : settings ? (
    <div className="col">
      <NumberField
        label="Port"
        value={settings.lan.port}
        min={1024}
        max={65535}
        onChange={(port) => setSettings({ ...settings, lan: { port } }).catch(reportError)}
      />
      {info ? (
        <>
          <RunningServer info={info} />
          <button className="danger" disabled={busy} onClick={() => run(() => useLanStore.getState().stop())}>
            Stop LAN server
          </button>
        </>
      ) : (
        <button
          className="primary"
          disabled={busy}
          onClick={() => run(() => useLanStore.getState().start(settings.lan.port))}
        >
          Start LAN server
        </button>
      )}
      <span className="muted small">
        Devices must be on the same network; every start makes a new link. Windows may ask to allow the app through the
        firewall.
      </span>
    </div>
  ) : (
    <span className="muted">Loading settings…</span>
  );
}
