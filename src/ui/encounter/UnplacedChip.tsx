import { useEncounterStore } from '@/state/encounterStore';
import { Button } from '../kit';
import { cancelInteraction, startPlacing, useEncounterUi } from './encounterUiStore';

/** Tray chip for combatants without a position; a click places them one after another. */
export function UnplacedChip({ className }: { className?: string }) {
  const count = useEncounterStore((s) => s.encounter?.combatants.filter((c) => c.position === null).length ?? 0);
  const firstId = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.position === null)?.id);
  const placingAll = useEncounterUi((s) => s.placingAll);
  return (
    firstId && (
      <Button
        className={className}
        icon="users"
        label={`${count} not on map – place`}
        title={placingAll ? 'Stop placing (Esc)' : 'Place them one after another'}
        active={placingAll}
        onClick={() => (placingAll ? cancelInteraction() : startPlacing(firstId, true))}
      />
    )
  );
}
