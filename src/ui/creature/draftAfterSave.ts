import type { Creature } from '@/core/model';

/**
 * The draft once `snapshot` was saved as `stored`. Edits made while the save ran are kept; they take the stored id
 * and the stored pictures they did not change, since a first save can move both to a new id.
 */
export function draftAfterSave(current: Creature, snapshot: Creature, stored: Creature): Creature {
  return current === snapshot
    ? stored
    : {
        ...current,
        id: stored.id,
        image: current.image === snapshot.image ? stored.image : current.image,
        token: current.token === snapshot.token ? stored.token : current.token,
      };
}
