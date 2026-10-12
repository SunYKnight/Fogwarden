import { useEffect, useState } from 'react';
import type { Encounter } from '@/core/model';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { currentCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button, PageHeader, useShortcuts } from '../kit';
import { AddCombatantsDialog } from './AddCombatants';
import { removeFromMap, stepTurn } from './combatantCommands';
import { ConcentrationDialog } from './ConcentrationDialog';
import { DifficultyBadge } from './EncounterDifficulty';
import { cancelInteraction, chooseTool, useEncounterUi } from './encounterUiStore';
import { EndCombatDialog } from './EndCombatDialog';
import { HpPromptDialog } from './HpPromptDialog';
import { InitiativeStrip } from './InitiativeStrip';
import { Inspector } from './Inspector';
import { PlayerMovesToggle } from './PlayerMovesToggle';
import { PlayViewport } from './PlayViewport';
import { TurnBar } from './TurnBar';

function historyStep(direction: 'undo' | 'redo'): void {
  const store = useEncounterStore.getState();
  const label = direction === 'undo' ? store.undo() : store.redo();
  if (label) useAppStore.getState().notify(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${label}`, 'info');
}

/** Esc: cancel what is in progress, then stop the fog brush, then deselect, then back to Select. */
function escape(): void {
  const cancelled = cancelInteraction();
  const fog = useFogViewStore.getState();
  const { selectedCombatantId, select } = useEncounterStore.getState();
  if (!cancelled && fog.brush !== 'off') {
    fog.setBrush('off');
  } else if (!cancelled && selectedCombatantId) {
    select(null);
  } else if (!cancelled) {
    chooseTool('select');
    useEncounterUi.setState({ fogMenuOpen: false });
  }
}

function removeSelectedFromMap(): void {
  const { encounter, selectedCombatantId } = useEncounterStore.getState();
  const selected = encounter?.combatants.find((c) => c.id === selectedCombatantId);
  if (selected?.position) removeFromMap(selected.id);
}

function usePlayShortcuts(): void {
  const dialogOpen = useEncounterUi(
    (s) => s.addDialogOpen || s.hpPrompt !== null || s.endCombatOpen || s.concentrationChecks.length > 0,
  );
  useShortcuts(
    'Play',
    [
      { keys: 'Space', label: 'Next turn (starts combat)', run: () => stepTurn('next') },
      { keys: 'Shift+Space', label: 'Previous turn', run: () => stepTurn('previous') },
      { keys: 'Ctrl+Z', label: 'Undo', run: () => historyStep('undo') },
      { keys: 'Ctrl+Y', label: 'Redo', run: () => historyStep('redo') },
      { keys: 'Ctrl+Shift+Z', label: 'Redo', run: () => historyStep('redo') },
      { keys: 'Escape', label: 'Cancel, stop brush, deselect, back to Select', run: escape },
      { keys: 'S', label: 'Select tool', run: () => chooseTool('select') },
      { keys: 'M', label: 'Measure tool', run: () => chooseTool('measure') },
      {
        keys: 'F',
        label: 'Fog menu',
        run: () => useEncounterUi.setState((s) => ({ fogMenuOpen: !s.fogMenuOpen })),
      },
      { keys: 'Delete', label: 'Remove selected token from the map', run: removeSelectedFromMap },
      { keys: 'Backspace', label: 'Remove selected token from the map', run: removeSelectedFromMap },
    ],
    !dialogOpen,
  );
}

function PlayHeader({ encounter, campaignName }: { encounter: Encounter; campaignName: string }) {
  const dirty = useEncounterStore((s) => s.revision !== s.savedRevision);
  const canUndo = useEncounterStore((s) => s.canUndo);
  const canRedo = useEncounterStore((s) => s.canRedo);
  const current = currentCombatant(encounter);
  const turn = current ? `Round ${encounter.round} · ${current.name}` : 'Combat not started';
  return (
    <PageHeader
      crumbs={[
        { label: 'Campaigns', route: { page: 'campaigns', campaignId: null } },
        { label: campaignName, route: { page: 'campaigns', campaignId: encounter.campaignId } },
        { label: encounter.name },
      ]}
      status={`${turn} · ${dirty ? 'Saving…' : 'Saved'}`}
    >
      <DifficultyBadge combatants={encounter.combatants} />
      <PlayerMovesToggle allowed={encounter.playersMoveTokens} />
      <Button
        icon="undo"
        label="Undo"
        iconOnly
        shortcut="Ctrl+Z"
        disabled={!canUndo}
        onClick={() => historyStep('undo')}
      />
      <Button
        icon="redo"
        label="Redo"
        iconOnly
        shortcut="Ctrl+Y"
        disabled={!canRedo}
        onClick={() => historyStep('redo')}
      />
    </PageHeader>
  );
}

function PlayLayout({ campaignName }: { campaignName: string }) {
  const encounter = useEncounterStore((s) => s.encounter);
  const map = useEncounterStore((s) => s.map);
  const terrain = useEncounterStore((s) => s.terrain);
  const addDialogOpen = useEncounterUi((s) => s.addDialogOpen);
  const endCombatOpen = useEncounterUi((s) => s.endCombatOpen);
  usePlayShortcuts();
  return (
    encounter && (
      <div className="page-frame">
        <PlayHeader encounter={encounter} campaignName={campaignName} />
        <div className="play-body">
          <InitiativeStrip encounter={encounter} />
          {map && terrain ? (
            <PlayViewport map={map} terrain={terrain} />
          ) : (
            <div className="play-viewport waiting">No map for this encounter: initiative tracker only.</div>
          )}
          <Inspector encounter={encounter} hasMap={map !== null} />
          <TurnBar encounter={encounter} />
        </div>
        {addDialogOpen && <AddCombatantsDialog />}
        <HpPromptDialog />
        {endCombatOpen && <EndCombatDialog encounter={encounter} />}
        <ConcentrationDialog />
      </div>
    )
  );
}

/**
 * Plays one encounter: initiative strip, battle map in DM mode, turn bar and inspector tabs. The encounter itself
 * stays loaded by `useActiveEncounter` when the DM leaves this page.
 */
export function EncounterPage({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const loadedId = useEncounterStore((s) => s.encounter?.id);
  const [campaignName, setCampaignName] = useState('Campaign');

  useEffect(() => {
    repository
      .listCampaigns()
      .then(({ campaigns }) => setCampaignName(campaigns.find((c) => c.id === campaignId)?.name ?? 'Campaign'))
      .catch(reportError);
  }, [campaignId, repository, reportError]);

  // Pointer modes and dialogs belong to this page, the encounter does not.
  useEffect(
    () => () => {
      cancelInteraction();
      useEncounterUi.setState({ addDialogOpen: false, hpPrompt: null, endCombatOpen: false });
    },
    [],
  );

  return loadedId === encounterId ? (
    <PlayLayout campaignName={campaignName} />
  ) : (
    <div className="waiting">Loading encounter…</div>
  );
}
