import { useEffect, useState } from 'react';
import { useAppStore } from '@/state/appStore';
import {
  acceptPlayerUpload,
  applyPlayerPicture,
  fetchPendingUpload,
  rejectPlayerUpload,
  usePlayerUploadStore,
  viewName,
  type AcceptedUpload,
  type PendingUpload,
} from '@/state/playerUploadStore';
import { PLAYER_UPLOAD_TYPES } from '@/sync/relayApi';
import { AssetImage } from '../components/AssetImage';
import { Button } from '../kit';

/** Runs a review action once at a time per row; failures go to the error report. */
function useAction(): [boolean, (action: () => Promise<unknown>, done: string) => void] {
  const { notify, reportError } = useAppStore.getState();
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    action()
      .then(() => notify(done, 'success'), reportError)
      .finally(() => setBusy(false));
  };
  return [busy, run];
}

/**
 * A waiting picture, previewed from the server's copy in this app only. A picture the webview cannot decode
 * cannot be accepted.
 */
function PendingRow({ upload }: { upload: PendingUpload }) {
  const reportError = useAppStore((s) => s.reportError);
  const { server, id, type } = upload;
  const [url, setUrl] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, run] = useAction();

  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;
    fetchPendingUpload({ server, id }).then((bytes) => {
      if (live) {
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: PLAYER_UPLOAD_TYPES[type] }));
        setUrl(objectUrl);
      }
    }, reportError);
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [server, id, type, reportError]);

  const who = viewName(upload.view);
  const status = unreadable ? 'Not a readable picture' : `${who} · ${Math.ceil(upload.size / 1024)} KB`;
  return (
    <div className="players-line">
      {url && !unreadable ? (
        <img src={url} alt={upload.name} className="creature-thumb" onError={() => setUnreadable(true)} />
      ) : (
        <span className="creature-thumb" />
      )}
      <div className="players-line-text">
        <strong title={upload.name}>{upload.name}</strong>
        <span className="muted small">{status}</span>
      </div>
      <div className="row">
        <Button
          icon="check"
          label="Accept"
          variant="primary"
          disabled={busy || url === null || unreadable}
          title="Keep it in the campaign's folder; players see it only once you use it"
          onClick={() => run(() => acceptPlayerUpload(upload), `Kept ${who}'s picture`)}
        />
        <Button
          icon="trash"
          label="Reject"
          iconOnly
          variant="danger"
          disabled={busy}
          onClick={() => run(() => rejectPlayerUpload(upload), `Deleted ${who}'s picture`)}
        />
      </div>
    </div>
  );
}

/** An accepted picture: the DM may make it the character's portrait or token picture. */
function AcceptedRow({ accepted }: { accepted: AcceptedUpload }) {
  const [busy, run] = useAction();
  const who = viewName(accepted.view);
  return (
    <div className="players-line">
      <AssetImage asset={accepted.ref} alt={accepted.name} className="creature-thumb" />
      <div className="players-line-text">
        <strong title={accepted.name}>{accepted.name}</strong>
        <span className="muted small">{who} · kept</span>
      </div>
      <div className="row">
        <Button
          icon="user"
          label="Portrait"
          disabled={busy}
          title={`Make it ${who}'s portrait`}
          onClick={() => run(() => applyPlayerPicture(accepted, 'image'), `${who} has a new portrait`)}
        />
        <Button
          icon="image"
          label="Token"
          disabled={busy}
          title={`Make it ${who}'s token picture`}
          onClick={() => run(() => applyPlayerPicture(accepted, 'token'), `${who} has a new token picture`)}
        />
      </div>
    </div>
  );
}

/** Pictures players sent: waiting ones to accept or reject, and the ones kept this session. */
export function PlayerUploadsLine() {
  const pending = usePlayerUploadStore((s) => s.pending);
  const accepted = usePlayerUploadStore((s) => s.accepted);
  return pending.length === 0 && accepted.length === 0 ? null : (
    <div className="col" aria-label="Pictures from players">
      <strong>Pictures from players</strong>
      {pending.map((upload) => (
        <PendingRow key={upload.id} upload={upload} />
      ))}
      {accepted.map((each) => (
        <AcceptedRow key={each.id} accepted={each} />
      ))}
    </div>
  );
}
