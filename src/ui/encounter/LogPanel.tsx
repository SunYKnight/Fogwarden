import { useState } from 'react';
import type { Encounter } from '@/core/model';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';

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
    <div className="panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Log</h2>
        <div className="spacer" />
        <button
          disabled={encounter.log.length === 0}
          onClick={() => {
            if (window.confirm('Clear the whole log?')) update((d) => void (d.log = []));
          }}
        >
          Clear
        </button>
      </div>
      <div className="row">
        <input
          className="grow"
          placeholder="Add a note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addNote();
          }}
        />
        <button onClick={addNote}>Add</button>
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
