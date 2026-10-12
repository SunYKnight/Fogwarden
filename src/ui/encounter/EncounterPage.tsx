import { useEffect, useState } from 'react';
import type { BattleMap, DocRef, Encounter } from '@/core/model';
import { libraryDocPath, type Repository } from '@/data/repository';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { flushEncounter } from '@/state/autosave';
import { currentCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Button, PageHeader, useShortcuts } from '../kit';
import { AddCombatantsDialog } from './AddCombatants';
import { removeFromMap, stepTurn } from './combatantCommands';
import { cancelInteraction, chooseTool, useEncounterUi } from './encounterUiStore';
import { HpPromptDialog } from './HpPromptDialog';
import { InitiativeStrip } from './InitiativeStrip';
import { Inspector } from './Inspector';
import { PlayViewport } from './PlayViewport';
import { TurnBar } from './TurnBar';

/** A shipped map edited after the encounter was created lives on as a user copy with the same id. */
async function loadEncounterMap(repository: Repository, ref: DocRef): Promise<BattleMap> {
  const edited =
    ref.area === 'content' && (await repository.storage.exists('data', libraryDocPath('map', 'data', ref.id)));
  return repository.load('map', edited ? { area: 'data', id: ref.id } : ref);
}

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
  const dialogOpen = useEncounterUi((s) => s.addDialogOpen || s.hpPrompt !== null);
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
      </div>
    )
  );
}

// Mount counter: a late cleanup must not close a newer mount's encounter.
let encounterSession = 0;

/** Plays one encounter: initiative strip, battle map in DM mode, turn bar and inspector tabs. */
export function EncounterPage({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const loadedId = useEncounterStore((s) => s.encounter?.id);
  const [campaignName, setCampaignName] = useState('Campaign');

  useEffect(() => {
    const session = ++encounterSession;
    // Stat blocks, spawning and marker templates read the library listings.
    useLibraryStore.getState().refreshAll().catch(reportError);
    const open = async () => {
      const [encounter, { campaigns }] = await Promise.all([
        repository.loadEncounter(campaignId, encounterId),
        repository.listCampaigns(),
      ]);
      // A missing map is reported; the encounter still runs as a tracker.
      const map = encounter.map
        ? await loadEncounterMap(repository, encounter.map).catch((error: unknown) => {
            reportError(error);
            return null;
          })
        : null;
      if (session === encounterSession) {
        setCampaignName(campaigns.find((c) => c.id === campaignId)?.name ?? 'Campaign');
        useEncounterStore.getState().open(encounter, map);
      }
    };
    open().catch(reportError);
    return () => {
      cancelInteraction();
      useEncounterUi.setState({ addDialogOpen: false, hpPrompt: null });
      flushEncounter()
        .catch(reportError)
        .finally(() => {
          if (session === encounterSession) useEncounterStore.getState().close();
        });
    };
  }, [campaignId, encounterId, repository, reportError]);

  return loadedId === encounterId ? (
    <PlayLayout campaignName={campaignName} />
  ) : (
    <div className="waiting">Loading encounter…</div>
  );
}
