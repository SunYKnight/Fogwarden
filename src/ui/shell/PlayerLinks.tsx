import { useMemo, useState } from 'react';
import { encode } from 'uqr';
import { PARTY_VIEW } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { rotateLink, useViewLinksStore } from '@/sync/views';
import { SelectField } from '../components/fields';
import { Button, confirmDialog } from '../kit';

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

/**
 * Player links, one per view (the party and each player character): pick a view, then copy its link, scan
 * it as QR code or replace it with a new one.
 */
export function PlayerLinks({ linkOf }: { linkOf: (token: string) => string }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const views = useViewLinksStore((s) => s.views);
  const tokens = useViewLinksStore((s) => s.tokens);
  const [chosen, setChosen] = useState(PARTY_VIEW);
  const view = views.find((v) => v.id === chosen) ?? views[0]!;
  const token = tokens[view.id];
  const url = token === undefined ? null : linkOf(token);

  const replace = async () => {
    const ok = await confirmDialog({
      title: `New link for ${view.name}`,
      message: 'The current link stops working at once; players who use it need the new one.',
      confirmLabel: 'New link',
      danger: true,
    });
    if (ok) await rotateLink(view.id);
  };

  return (
    <div className="col">
      <div className="row player-links-head">
        <SelectField
          label="Link for"
          value={view.id}
          options={views.map((v) => v.id)}
          format={(id) => views.find((v) => v.id === id)?.name ?? id}
          onChange={setChosen}
        />
        <Button icon="undo" label="New link" onClick={() => void replace().catch(reportError)} />
      </div>
      {url === null ? (
        <p className="muted small">Preparing links…</p>
      ) : (
        <>
          <div className="row">
            <code className="grow small lan-url">{url}</code>
            <Button
              icon="copy"
              label="Copy link"
              iconOnly
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(url).then(() => notify('Link copied', 'info'), reportError)}
            />
          </div>
          <QrCode text={url} />
        </>
      )}
    </div>
  );
}
