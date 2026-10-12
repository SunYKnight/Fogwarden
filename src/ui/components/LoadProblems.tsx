import { useMemo } from 'react';
import type { LibraryKind } from '@/data/repository';
import { useLibraryStore } from '@/state/libraryStore';

/** Library files of the given kinds that could not be read, so broken files never disappear silently. */
export function LoadProblems({ kinds }: { kinds: LibraryKind[] }) {
  const listings = useLibraryStore((s) => s.listings);
  const problems = useMemo(() => kinds.flatMap((k) => listings[k].problems), [kinds, listings]);
  return problems.length > 0 ? (
    <div className="panel" style={{ borderColor: 'var(--danger)', marginBottom: 10 }}>
      <h3>Files that could not be loaded</h3>
      {problems.map((p) => (
        <div key={`${p.area}:${p.path}`} className="muted">
          {p.area}:{p.path} — {p.message}
        </div>
      ))}
    </div>
  ) : null;
}
