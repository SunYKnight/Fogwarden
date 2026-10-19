import { produce } from 'immer';
import { useState } from 'react';
import type { DocRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { flushEncounter } from '@/state/autosave';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { remoteChangeMap, useRemoteDmStore } from '@/sync/dmMirror';
import { MapPicker } from '../components/MapPicker';
import { Button, Dialog } from '../kit';
import { cancelInteraction, useEncounterUi } from './encounterUiStore';

const close = () => useEncounterUi.setState({ mapDialogOpen: false });

async function moveEncounter(ref: DocRef | null): Promise<void> {
  const { repository } = useAppStore.getState();
  const map = ref ? await repository.load('map', ref) : null;
  // The pending autosave of the old state must not land after the new one.
  await flushEncounter();
  const current = useEncounterStore.getState().encounter;
  if (!current) {
    throw new Error('No encounter is open');
  }
  const next = produce(current, (d) => {
    d.map = ref;
    d.turnStart = null;
    d.markers = [];
    d.openingStates = {};
    d.fog = { cellsPerSquare: d.fog.cellsPerSquare, exploredBy: {}, revealedByDm: '', hiddenByDm: '' };
    d.combatants.forEach((c) => void (c.position = null));
    addLog(d, 'note', map ? `Map changed to ${map.name}` : 'Map removed');
  });
  const saved = await repository.saveEncounter(next);
  cancelInteraction();
  useEncounterUi.setState({ areaTargetsId: null });
  useEncounterStore.getState().open(saved, map);
}

/**
 * Moves the running encounter to another map. Positions, doors, fog and area templates belong to the old
 * map's ground, so they go; combatants, initiative, HP and the log stay. A remote DM asks the desktop app,
 * which owns the encounter's files, to do it.
 */
export async function changeMap(ref: DocRef | null): Promise<void> {
  if (useRemoteDmStore.getState().host === null) {
    await moveEncounter(ref);
  } else {
    remoteChangeMap(ref);
    cancelInteraction();
    useEncounterUi.setState({ areaTargetsId: null });
  }
}

/** "Choose map…" / "Change map…" of Play: picks the map and says what is cleared. */
export function ChangeMapDialog() {
  const reportError = useAppStore((s) => s.reportError);
  const current = useEncounterStore((s) => s.encounter?.map ?? null);
  const [picked, setPicked] = useState<DocRef | null>(current);
  const [busy, setBusy] = useState(false);
  const unchanged = picked?.id === current?.id && picked?.area === current?.area;

  const apply = () => {
    setBusy(true);
    changeMap(picked)
      .then(close)
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      title={current ? 'Change map' : 'Choose map'}
      onClose={close}
      width={760}
      footer={
        <>
          <Button label="Cancel" onClick={close} />
          <Button label="Use this map" variant="primary" disabled={busy || unchanged} onClick={apply} />
        </>
      }
    >
      <p className="muted">
        Combatants, initiative and hit points stay. Tokens leave the map for you to place again; fog, opened doors and
        area templates start over.
      </p>
      <MapPicker value={picked} onChange={setPicked} />
    </Dialog>
  );
}
