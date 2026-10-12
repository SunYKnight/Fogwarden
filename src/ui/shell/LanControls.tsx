import { isTauri } from '@tauri-apps/api/core';
import { useMemo, useState } from 'react';
import { encode } from 'uqr';
import { useAppStore } from '@/state/appStore';
import { useLanStore, type LanInfo } from '@/state/lanStore';
import { Button } from '../kit';

export function QrCode({ text }: { text: string }) {
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

function RunningServer({ info }: { info: LanInfo }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [selected, setSelected] = useState(0);
  const qrUrl = info.urls[Math.min(selected, info.urls.length - 1)] ?? '';
  return (
    <>
      <div className="lan-urls" role="radiogroup" aria-label="Link shown as QR code">
        {info.urls.map((url, index) => (
          <div key={url} className="row">
            <input
              type="radio"
              checked={url === qrUrl}
              onChange={() => setSelected(index)}
              aria-label={`Show ${url} as QR code`}
            />
            <code className="grow small lan-url">{url}</code>
            <Button
              icon="copy"
              label="Copy link"
              iconOnly
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(url).then(() => notify('Link copied', 'info'), reportError)}
            />
          </div>
        ))}
      </div>
      <QrCode text={qrUrl} />
    </>
  );
}

/** Starts the LAN server so phones and tablets on the same network open the player view in a browser. */
export function LanControls() {
  const port = useAppStore((s) => s.settings?.lan.port ?? null);
  const reportError = useAppStore((s) => s.reportError);
  const info = useLanStore((s) => s.info);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    action()
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  return !isTauri() ? (
    <p className="muted small">The LAN server needs the desktop app.</p>
  ) : (
    <div className="col">
      {info ? (
        <>
          <RunningServer info={info} />
          <Button
            icon="close"
            label="Stop LAN"
            variant="danger"
            disabled={busy}
            onClick={() => run(() => useLanStore.getState().stop())}
          />
        </>
      ) : (
        <Button
          icon="wifi"
          label={port === null ? 'Start LAN' : `Start LAN on port ${port}`}
          variant="primary"
          disabled={busy || port === null}
          onClick={() => run(() => (port === null ? Promise.resolve() : useLanStore.getState().start(port)))}
        />
      )}
      <p className="muted small">
        Phones and tablets on the same network open a link or scan the code. Every start makes a new link; Windows may
        ask to allow the app through the firewall. The port is in Settings.
      </p>
    </div>
  );
}
