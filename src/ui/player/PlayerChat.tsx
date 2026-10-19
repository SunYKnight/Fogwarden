import { useEffect, useRef, useState } from 'react';
import { PLAYER_CHAT_MAX, type SyncPayload } from '@/sync/protocol';
import { Icon } from '../kit';
import { usePlayerStore } from './playerStore';

const NOTICE_MS = 6000;

/**
 * The chat on a character's own link: a button with the unread count that opens a drawer (a bottom sheet on
 * phones). With `canWrite` the player writes to everyone or only to the DM; shared rolls show either way.
 */
export function PlayerChat({ canWrite, send }: { canWrite: boolean; send: (payload: SyncPayload) => void }) {
  const lines = usePlayerStore((s) => s.chat);
  const unread = usePlayerStore((s) => s.chatUnread);
  const markChatRead = usePlayerStore((s) => s.markChatRead);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [toDm, setToDm] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      markChatRead();
      end.current?.scrollIntoView({ block: 'end' });
    }
  }, [open, lines.length, markChatRead]);

  const submit = () => {
    const line = text.trim();
    if (line !== '') {
      send({ type: 'chat', text: line, to: toDm ? 'dm' : 'all' });
      setText('');
    }
  };

  return (
    <div className={open ? 'player-chat open' : 'player-chat'}>
      <button className="player-chat-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chat" /> Chat
        {unread > 0 && !open && <span className="chip">{unread}</span>}
        {open && <Icon name="chevronDown" />}
      </button>
      {open && (
        <>
          <div className="chat-lines" aria-live="polite" aria-label="Chat">
            {lines.length === 0 && <p className="muted small">No messages yet.</p>}
            {lines.map((line) => (
              <div key={line.id} className={`chat-line ${line.kind}${line.whisper ? ' whisper' : ''}`}>
                <strong>{line.by}</strong>
                {line.whisper && <span className="muted small"> (whisper)</span>} {line.text}
              </div>
            ))}
            <div ref={end} />
          </div>
          {canWrite && (
            <div className="col">
              <div className="row">
                <input
                  className="grow"
                  aria-label="Message"
                  placeholder={toDm ? 'Whisper to the DM' : 'Message to everyone'}
                  maxLength={PLAYER_CHAT_MAX}
                  enterKeyHint="send"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                />
                <button className="primary" disabled={text.trim() === ''} onClick={submit}>
                  Send
                </button>
              </div>
              <label className="muted small">
                <input type="checkbox" checked={toDm} onChange={(e) => setToDm(e.target.checked)} /> Only to the DM
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The DM app's latest news for this view, e.g. that a sheet change waits for the DM; it fades after a while. */
export function PlayerNotice() {
  const notice = usePlayerStore((s) => s.notice);
  const [hidden, setHidden] = useState<number | null>(null);
  useEffect(() => {
    const timer = notice && window.setTimeout(() => setHidden(notice.seq), NOTICE_MS);
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [notice]);
  return notice && hidden !== notice.seq ? (
    <div className="player-notice" role="status">
      {notice.text}
    </div>
  ) : null;
}
