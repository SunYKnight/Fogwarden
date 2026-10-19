import { useRef, useState } from 'react';
import { errorMessage } from '@/core/errors';
import {
  PLAYER_UPLOAD_MAX_BYTES,
  PLAYER_UPLOAD_SNIFF_BYTES,
  playerUploadName,
  playerUploadTarget,
  sniffPicture,
} from '@/sync/relayApi';
import { Icon } from '../kit';

/** Where a browser player's link uploads: the LAN server or the relay that served the page. */
export interface UploadTarget {
  serverUrl: string;
  token: string;
}

/** Sends one picture; `onProgress` gets the sent share (0..1). Rejects with the server's reason. */
function sendPicture(target: UploadTarget, file: File, onProgress: (share: number) => void): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const url = `${target.serverUrl}${playerUploadTarget(playerUploadName(file.name))}`;
  const request = new XMLHttpRequest();
  request.open('PUT', `${url}?token=${encodeURIComponent(target.token)}`);
  request.upload.onprogress = (event) => onProgress(event.lengthComputable ? event.loaded / event.total : 0);
  request.onload = () => {
    if (request.status >= 200 && request.status < 300) {
      resolve();
    } else {
      reject(new Error(request.responseText.trim() || `The server answered ${request.status}`));
    }
  };
  request.onerror = () => reject(new Error('The picture did not reach the server; check the connection'));
  request.send(file);
  return promise;
}

/**
 * "Upload picture" on a character's own link: a PNG, JPEG or WebP goes to the DM, who decides whether anyone
 * ever sees it. The same checks as the server's run first, so a wrong file is explained without sending it.
 */
export function PictureUpload({ target }: { target: UploadTarget }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const upload = async (file: File) => {
    setMessage(null);
    setProgress(0);
    try {
      const head = new Uint8Array(await file.slice(0, PLAYER_UPLOAD_SNIFF_BYTES).arrayBuffer());
      if (file.size > PLAYER_UPLOAD_MAX_BYTES) {
        throw new Error(`Pictures may have at most ${PLAYER_UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
      }
      if (sniffPicture(head) === null) {
        throw new Error('Only PNG, JPEG and WebP pictures');
      }
      await sendPicture(target, file, setProgress);
      setMessage({ text: 'Sent. The DM decides whether to use it.', error: false });
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="picture-upload">
      <button disabled={progress !== null} onClick={() => input.current?.click()}>
        <Icon name="upload" /> Upload picture
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
      {progress !== null && <progress max={1} value={progress} aria-label="Upload progress" />}
      {message && <div className={message.error ? 'error-text' : 'muted small'}>{message.text}</div>}
    </div>
  );
}
