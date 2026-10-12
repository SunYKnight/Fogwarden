import { useState } from 'react';
import type { Encounter } from '@/core/model';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button, confirmDialog } from '../kit';

const MAX_SHOWN = 200;

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Encounter log, newest first, with a free note input. */
export function LogPanel({ encounter }: { encounter: Encounter }) {
  const update = useEncounterStore((s) => s.update);
  const [note, setNote] = useState('');
  const entries = encounter.log.slice(-MAX_SHOWN).reverse();

  const addNote = () => {
    const text = note.trim();
    if (text !== '') {
      update((d) => addLog(d, 'note', text));
      setNote('');
    }
  };

  return (
    <div className="col log-panel">
      <div className="row">
        <input
          className="grow"
          placeholder="Add a note"
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addNote();
          }}
        />
        <Button label="Add" onClick={addNote} />
        <Button
          icon="trash"
          label="Clear log"
          iconOnly
          variant="ghost"
          disabled={encounter.log.length === 0}
          onClick={() => {
            void confirmDialog({
              title: 'Clear log',
              message: 'All log entries of this encounter are deleted. This cannot be undone.',
              confirmLabel: 'Clear log',
              danger: true,
            }).then((ok) => ok && update((d) => void (d.log = [])));
          }}
        />
      </div>
      <div className="log">
        {entries.map((e) => (
          <div key={e.id} className={`log-entry ${e.kind}`}>
            <span className="muted small">{time(e.at)}</span> {e.text}
          </div>
        ))}
      </div>
    </div>
  );
}
