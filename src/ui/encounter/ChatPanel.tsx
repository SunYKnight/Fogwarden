import { useEffect, useRef, useState } from 'react';
import { CHAT_EVERYONE, CHAT_TO_DM, PARTY_VIEW, type ChatLine, type Encounter } from '@/core/model';
import { useEncounterStore } from '@/state/encounterStore';
import { appendChat, chatLine, DM_NAME } from '@/sync/chat';
import { useViewLinksStore } from '@/sync/views';
import { Button } from '../kit';
import { AudienceField, EVERYONE } from './AudienceField';

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Who besides the writer reads a line, as the DM sees it. */
function receivers(line: ChatLine, nameOf: (view: string) => string): string {
  return line.to === CHAT_EVERYONE ? '' : line.to === CHAT_TO_DM ? 'to you' : `to ${nameOf(line.to)}`;
}

/**
 * The encounter's chat with the players' own links: every line, whispers included, and a line to everyone or
 * one character's view. The party view never gets chat.
 */
export function ChatPanel({ encounter }: { encounter: Encounter }) {
  const update = useEncounterStore((s) => s.update);
  const views = useViewLinksStore((s) => s.views);
  const features = useViewLinksStore((s) => s.features);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState(EVERYONE);
  const end = useRef<HTMLDivElement>(null);
  const characters = views.filter((v) => v.id !== PARTY_VIEW);
  const nameOf = (view: string) => views.find((v) => v.id === view)?.name ?? view;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [encounter.chat.length]);

  const send = () => {
    const line = text.trim();
    if (line !== '') {
      const to = audience === EVERYONE ? CHAT_EVERYONE : audience;
      update((d) => appendChat(d, chatLine(null, DM_NAME, to, 'say', line)));
      setText('');
    }
  };

  return (
    <div className="col chat-panel">
      {!features.chat && (
        <p className="muted small">
          Players read and write here only while the campaign lets them chat (Campaigns › Party).
        </p>
      )}
      <div className="chat-lines" aria-live="polite">
        {encounter.chat.map((line) => (
          <div key={line.id} className={`chat-line ${line.kind}${line.to === CHAT_EVERYONE ? '' : ' whisper'}`}>
            <span className="muted small">{time(line.at)}</span> <strong>{line.name}</strong>{' '}
            <span className="muted small">{receivers(line, nameOf)}</span> {line.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <AudienceField label="Send to" value={audience} views={characters} onChange={setAudience} />
      <div className="row">
        <input
          className="grow"
          placeholder={audience === EVERYONE ? 'Message to everyone' : `Whisper to ${nameOf(audience)}`}
          aria-label="Chat message"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <Button label="Send" onClick={send} disabled={text.trim() === ''} />
      </div>
    </div>
  );
}
