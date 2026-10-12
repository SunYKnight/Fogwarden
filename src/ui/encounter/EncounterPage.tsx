import { useCallback, useEffect } from 'react';
import type { BattleMap, DocRef } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { libraryDocPath, type Repository } from '@/data/repository';
import { fogBrushPointer } from '@/render/fog/fogBrush';
import { useFogViewStore } from '@/render/fog/fogViewStore';
import { SCENE_LAYERS } from '@/render/layers';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { MapView } from '@/render/MapView';
import { useAppStore } from '@/state/appStore';
import { flushEncounter } from '@/state/autosave';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { useDmCameraStore } from '@/sync/cameraStore';
import { openPlayerWindow } from '../playerWindow';
import { AddCombatants } from './AddCombatants';
import { CombatantPanel } from './CombatantPanel';
import { DiceRoller } from './DiceRoller';
import { EncounterOverlay } from './EncounterOverlay';
import { ENCOUNTER_PANELS } from './encounterPanels';
import { handleEncounterPointer } from './encounterPointer';
import { cancelInteraction, useEncounterUi } from './encounterUiStore';
import { InitiativeTracker } from './InitiativeTracker';
import { LogPanel } from './LogPanel';
import { MarkerPanel } from './MarkerPanel';

/** A shipped map edited after the encounter was created lives on as a user copy with the same id. */
async function loadEncounterMap(repository: Repository, ref: DocRef): Promise<BattleMap> {
  const edited =
    ref.area === 'content' && (await repository.storage.exists('data', libraryDocPath('map', 'data', ref.id)));
  return repository.load('map', edited ? { area: 'data', id: ref.id } : ref);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

function useEscapeCancels() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTyping(e.target)) cancelInteraction();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function ViewportHint() {
  const placement = useEncounterUi((s) => s.placement);
  const placingId = useEncounterUi((s) => s.placingId);
  const tool = useEncounterUi((s) => s.tool);
  const placingName = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.id === placingId)?.name);
  const hints: [boolean, string][] = [
    [placement !== null && placement.origin === null, `Click the origin of ${placement?.template.name} · Esc cancels`],
    [placement !== null, 'Move the pointer to aim, click to confirm · Esc cancels'],
    [placingName !== undefined, `Click a square to place ${placingName} · Esc cancels`],
    [tool === 'measure', 'Drag on the map to measure'],
  ];
  const fallback = 'Click a token to select, drag to move · Click a door to open or close it, Shift+click to lock';
  return <div className="viewport-hint">{hints.find(([active]) => active)?.[1] ?? fallback}</div>;
}

function Toolbar({ hasMap }: { hasMap: boolean }) {
  const encounter = useEncounterStore((s) => s.encounter);
  const dirty = useEncounterStore((s) => s.revision !== s.savedRevision);
  const tool = useEncounterUi((s) => s.tool);
  const camera = useEncounterUi((s) => s.camera);
  const navigate = useAppStore((s) => s.navigate);
  const settings = useAppStore((s) => s.settings);
  const reportError = useAppStore((s) => s.reportError);
  const setUi = useEncounterUi.setState;
  return (
    <div className="topbar toolbar">
      <button onClick={() => flushEncounter().then(() => navigate({ page: 'library' }), reportError)}>← Library</button>
      <strong>{encounter?.name}</strong>
      <span className="muted">{dirty ? 'saving…' : 'saved'}</span>
      <div className="spacer" />
      {hasMap && (
        <>
          <button
            className={tool === 'select' ? 'active' : ''}
            onClick={() => setUi({ tool: 'select', measure: null })}
          >
            Select
          </button>
          <button className={tool === 'measure' ? 'active' : ''} onClick={() => setUi({ tool: 'measure', drag: null })}>
            Measure
          </button>
          <button className={camera === 'top' ? 'active' : ''} onClick={() => setUi({ camera: 'top' })}>
            Top
          </button>
          <button className={camera === 'perspective' ? 'active' : ''} onClick={() => setUi({ camera: 'perspective' })}>
            3D
          </button>
        </>
      )}
      <button disabled={!settings} onClick={() => settings && openPlayerWindow(settings).catch(reportError)}>
        Player view
      </button>
    </div>
  );
}

/** Unplaced combatants; clicking one arms placement with the next map click. */
function Tray() {
  const combatants = useEncounterStore((s) => s.encounter?.combatants);
  const placingId = useEncounterUi((s) => s.placingId);
  const unplaced = combatants?.filter((c) => c.position === null) ?? [];
  return (
    unplaced.length > 0 && (
      <div className="tray">
        <span className="muted small">Not on the map:</span>
        {unplaced.map((c) => (
          <button
            key={c.id}
            className={c.id === placingId ? 'active' : ''}
            onClick={() => useEncounterUi.setState({ placingId: c.id, placement: null, tool: 'select' })}
          >
            {c.name}
          </button>
        ))}
      </div>
    )
  );
}

function Viewport({ map, terrain }: { map: BattleMap; terrain: HeightField }) {
  const reportError = useAppStore((s) => s.reportError);
  const camera = useEncounterUi((s) => s.camera);
  const showFog = useFogViewStore((s) => s.showFogToDm);

  const onPointer = useCallback(
    (event: MapPointerEvent) => {
      try {
        if (!fogBrushPointer(event)) handleEncounterPointer(event);
      } catch (error) {
        reportError(error);
      }
    },
    [reportError],
  );

  return (
    <div className="viewport">
      <MapView
        map={map}
        terrain={terrain}
        terrainVersion={0}
        mode="dm"
        fogMode={showFog ? 'dm' : 'off'}
        camera={camera}
        ambient={map.ambientLight}
        onCameraChange={useDmCameraStore.getState().setCamera}
        onPointer={onPointer}
      >
        {SCENE_LAYERS.map(({ id, Component }) => (
          <Component key={id} />
        ))}
        <EncounterOverlay />
      </MapView>
      <ViewportHint />
      <Tray />
    </div>
  );
}

function EncounterLayout() {
  const encounter = useEncounterStore((s) => s.encounter);
  const map = useEncounterStore((s) => s.map);
  const terrain = useEncounterStore((s) => s.terrain);
  return (
    encounter && (
      <div className="editor encounter">
        <Toolbar hasMap={map !== null} />
        <div className="side left">
          <InitiativeTracker encounter={encounter} />
          <AddCombatants />
        </div>
        {map && terrain ? (
          <Viewport map={map} terrain={terrain} />
        ) : (
          <div className="waiting">No map for this encounter — initiative tracker only.</div>
        )}
        <div className="side">
          <CombatantPanel />
          <DiceRoller />
          {map && <MarkerPanel encounter={encounter} />}
          <LogPanel encounter={encounter} />
          {ENCOUNTER_PANELS.map(({ id, label, Component }) => (
            <div key={id} className="panel">
              <h2>{label}</h2>
              <Component />
            </div>
          ))}
        </div>
      </div>
    )
  );
}

// Mount counter: a late cleanup must not close a newer mount's encounter.
let encounterSession = 0;

/** Plays one encounter: tracker, combatant details, dice, log and the battle map in DM mode. */
export function EncounterPage({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const loadedId = useEncounterStore((s) => s.encounter?.id);
  useEscapeCancels();

  useEffect(() => {
    const session = ++encounterSession;
    // Stat blocks, spawning and marker templates read the library listings.
    useLibraryStore.getState().refreshAll().catch(reportError);
    const open = async () => {
      const encounter = await repository.loadEncounter(campaignId, encounterId);
      // A missing map is reported; the encounter still runs as a tracker.
      const map = encounter.map
        ? await loadEncounterMap(repository, encounter.map).catch((error: unknown) => {
            reportError(error);
            return null;
          })
        : null;
      if (session === encounterSession) useEncounterStore.getState().open(encounter, map);
    };
    open().catch(reportError);
    return () => {
      cancelInteraction();
      flushEncounter()
        .catch(reportError)
        .finally(() => {
          if (session === encounterSession) useEncounterStore.getState().close();
        });
    };
  }, [campaignId, encounterId, repository, reportError]);

  return loadedId === encounterId ? <EncounterLayout /> : <div className="waiting">Loading encounter…</div>;
}
