import { MY_CONTENT } from '@/data/packs';
import { packName, useLibraryStore } from '@/state/libraryStore';
import { Icon } from '../kit';

/** Where a library entry comes from: a pack (read-only), the user's copy overriding packs, or the user's own. */
export function OriginBadge({ entry }: { entry: { pack: string; overrides: string[] } }) {
  const packs = useLibraryStore((s) => s.packs);
  const mine = entry.pack === MY_CONTENT;
  const fromPack = packName(packs, entry.pack);
  const overridden = entry.overrides.map((id) => packName(packs, id)).join(', ');
  const label = !mine ? fromPack : entry.overrides.length > 0 ? 'your copy' : 'yours';
  const title = !mine
    ? `From the pack "${fromPack}"; editing creates your copy`
    : entry.overrides.length > 0
      ? `Your copy; replaces the version from ${overridden}`
      : undefined;
  return (
    <span className={`badge ${mine ? 'data' : 'content'}`} title={title}>
      {!mine && <Icon name="lock" size={12} />} {label}
    </span>
  );
}
