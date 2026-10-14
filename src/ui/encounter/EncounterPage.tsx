import { useEffect, useState } from 'react';
import type { Encounter } from '@/core/model';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { currentCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button, EmptyState, openContextMenu, PageHeader, useShortcuts } from '../kit';
import { AddCombatantsDialog } from './AddCombatants';
import { ChangeMapDialog } from './ChangeMapDialog';
import { removeFromMap, stepTurn } from './combatantCommands';
import { ConcentrationDialog } from './ConcentrationDialog';
import { CreatureDock } from './CreatureDock';
import { DifficultyBadge } from './EncounterDifficulty';
import { cancelInteraction, chooseTool, useEncounterUi } from './encounterUiStore';
import { EndCombatDialog } from './EndCombatDialog';
import { HpPromptDialog } from './HpPromptDialog';
import { InitiativeStrip } from './InitiativeStrip';
import { Inspector } from './Inspector';
import { PlayViewport } from './PlayViewport';
import { reloadActiveEncounter, useEncounterLoadFailure } from './useActiveEncounter';

type CombatStep = 'setup' | 'combat' | 'wrapup';

const COMBAT_STEPS: Record<CombatStep, string> = { setup: 'Set up', combat: 'Combat', wrapup: 'Wrap up' };

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

// Dialogs register as layers, and the shortcut host ignores keys behind them.
function usePlayShortcuts(): void {
  useShortcuts('Play', [
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
  ]);
}

/** Where the fight stands: set up, combat or wrap up, the current one marked. */
function CombatStepper({ step }: { step: CombatStep }) {
  return (
    <ol className="combat-stepper" aria-label="Combat steps">
      {(Object.keys(COMBAT_STEPS) as CombatStep[]).map((s) => (
        <li key={s} className={s === step ? 'current' : ''} aria-current={s === step ? 'step' : undefined}>
          {COMBAT_STEPS[s]}
        </li>
      ))}
    </ol>
  );
}

function PlayHeader({ encounter, campaignName }: { encounter: Encounter; campaignName: string }) {
  const dirty = useEncounterStore((s) => s.revision !== s.savedRevision);
  const canUndo = useEncounterStore((s) => s.canUndo);
  const canRedo = useEncounterStore((s) => s.canRedo);
  const endCombatOpen = useEncounterUi((s) => s.endCombatOpen);
  const current = currentCombatant(encounter);
  const started = encounter.round > 0;
  const step: CombatStep = endCombatOpen ? 'wrapup' : started ? 'combat' : 'setup';
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
      <CombatStepper step={step} />
      <DifficultyBadge
        combatants={encounter.combatants}
        onClick={() => {
          useEncounterStore.getState().select(null);
          useEncounterUi.setState({ inspectorTab: 'encounter' });
        }}
      />
      {started && (
        <Button icon="check" label="End combat…" onClick={() => useEncounterUi.setState({ endCombatOpen: true })} />
      )}
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
      <Button
        icon="more"
        label="More encounter actions"
        iconOnly
        variant="ghost"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          openContextMenu(box.left, box.bottom + 4, [
            {
              label: encounter.map ? 'Change map…' : 'Choose map…',
              icon: 'map',
              run: () => useEncounterUi.setState({ mapDialogOpen: true }),
            },
          ]);
        }}
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
  const mapDialogOpen = useEncounterUi((s) => s.mapDialogOpen);
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
            <div className="play-viewport waiting">
              <EmptyState
                icon="map"
                title="No map for this encounter."
                action={
                  <Button
                    icon="map"
                    label="Choose map…"
                    onClick={() => useEncounterUi.setState({ mapDialogOpen: true })}
                  />
                }
              >
                The initiative tracker works without one.
              </EmptyState>
            </div>
          )}
          <Inspector encounter={encounter} hasMap={map !== null} />
          <CreatureDock encounter={encounter} hasMap={map !== null} />
        </div>
        {addDialogOpen && <AddCombatantsDialog />}
        <HpPromptDialog />
        {endCombatOpen && <EndCombatDialog encounter={encounter} />}
        {mapDialogOpen && <ChangeMapDialog />}
        <ConcentrationDialog />
      </div>
    )
  );
}

/**
 * Plays one encounter: initiative strip, battle map in DM mode, creature dock and inspector tabs. The encounter
 * itself stays loaded by `useActiveEncounter` when the DM leaves this page.
 */
export function EncounterPage({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const loadedId = useEncounterStore((s) => s.encounter?.id);
  const failed = useEncounterLoadFailure((s) => s.failedId === encounterId);
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
      useEncounterUi.setState({ addDialogOpen: false, hpPrompt: null, endCombatOpen: false, mapDialogOpen: false });
    },
    [],
  );

  let page = <div className="waiting">Loading encounter…</div>;
  if (loadedId === encounterId) {
    page = <PlayLayout campaignName={campaignName} />;
  } else if (failed) {
    page = (
      <div className="page-frame">
        <EmptyState
          icon="alert"
          title="This encounter could not be loaded."
          action={
            <div className="row">
              <Button icon="undo" label="Try again" onClick={() => reloadActiveEncounter().catch(reportError)} />
              <Button
                icon="swords"
                label="Go to campaigns"
                onClick={() => useAppStore.getState().navigate({ page: 'campaigns', campaignId })}
              />
            </div>
          }
        />
      </div>
    );
  }
  return page;
}
