import type { LibraryKind } from '@/data/repository';
import { LoadProblems } from '../components/LoadProblems';
import { PageHeader } from '../kit';
import { MapLibrary } from '../library/MapLibrary';

const KINDS: LibraryKind[] = ['map'];

export function MapsPage() {
  return (
    <div className="page-frame">
      <PageHeader crumbs={[{ label: 'Maps' }]} />
      <div className="page-body">
        <LoadProblems kinds={KINDS} />
        <MapLibrary />
      </div>
    </div>
  );
}
