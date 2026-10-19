import { usePlayerDataStore } from '@/sync/playerData';
import { acceptSheetEdit, rejectSheetEdit } from '@/sync/sheetEdits';
import { Button } from '../kit';

/** Sheet edits players asked for while the campaign wants the DM to accept each one. */
export function PlayerEditsLine() {
  const pending = usePlayerDataStore((s) => s.pending);
  return pending.length === 0 ? null : (
    <div className="col" aria-label="Sheet changes from players">
      <strong>Sheet changes from players</strong>
      {pending.map((edit) => (
        <div key={edit.id} className="players-line">
          <div className="players-line-text">
            <span>{edit.text}</span>
          </div>
          <div className="row">
            <Button
              icon="check"
              label="Accept"
              variant="primary"
              title="Apply it as one undo step; it is dropped if you changed the value meanwhile"
              onClick={() => acceptSheetEdit(edit.id)}
            />
            <Button icon="close" label="Reject" iconOnly variant="danger" onClick={() => rejectSheetEdit(edit.id)} />
          </div>
        </div>
      ))}
    </div>
  );
}
