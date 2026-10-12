import { useCallback, useRef, useState } from 'react';
import type { BattleMap } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { fogBrushPointer } from '@/render/fog/fogBrush';
import { useFogViewStore, type FogBrushMode } from '@/render/fog/fogViewStore';
import { SCENE_LAYERS } from '@/render/layers';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { MapView } from '@/render/MapView';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useDmCameraStore } from '@/sync/cameraStore';
import { CheckboxField, SelectField, SliderField } from '../components/fields';
import { Button, Dialog, Popover, ToolButton, type IconName } from '../kit';
import { EncounterOverlay } from './EncounterOverlay';
import { handleEncounterPointer } from './encounterPointer';
import { cancelInteraction, chooseTool, startPlacing, useEncounterUi } from './encounterUiStore';
import { AreaTemplatePicker } from './MarkerPanel';
import { openCombatantMenu } from './tokenMenu';

// A right release nearer than this to its press is a click (menu), not a pan.
const CLICK_SLOP_PX = 4;

const BRUSHES: { mode: FogBrushMode; label: string; icon: IconName }[] = [
  { mode: 'off', label: 'Off', icon: 'cursor' },
  { mode: 'reveal', label: 'Reveal', icon: 'eye' },
  { mode: 'hide', label: 'Hide', icon: 'eyeOff' },
  { mode: 'erase', label: 'Erase', icon: 'eraser' },
];

const BRUSH_HINT: Record<FogBrushMode, string> = {
  off: '',
  reveal: 'Drag to reveal fog for the players · Esc stops the brush',
  hide: 'Drag to hide areas from the players · Esc stops the brush',
  erase: 'Drag to erase revealed and hidden areas · Esc stops the brush',
};

function ViewportHint() {
  const placement = useEncounterUi((s) => s.placement);
  const placingId = useEncounterUi((s) => s.placingId);
  const placingAll = useEncounterUi((s) => s.placingAll);
  const tool = useEncounterUi((s) => s.tool);
  const brush = useFogViewStore((s) => s.brush);
  const placingName = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.id === placingId)?.name);
  const hints: [boolean, string][] = [
    [placement !== null && placement.origin === null, `Click the origin of ${placement?.template.name} · Esc cancels`],
    [placement !== null, 'Move the pointer to aim, click to confirm · Esc cancels'],
    [
      placingName !== undefined && placingAll,
      `Click a square to place ${placingName}, the next one follows · Esc stops`,
    ],
    [placingName !== undefined, `Click a square to place ${placingName} · Esc cancels`],
    [brush !== 'off', BRUSH_HINT[brush]],
    [tool === 'measure', 'Drag on the map to measure · S returns to Select'],
  ];
  const fallback =
    'Click a token to select, drag to move, right-click for actions · ' +
    'Click a door to open or close it, Shift+click to lock';
  return <div className="viewport-hint">{hints.find(([active]) => active)?.[1] ?? fallback}</div>;
}

const ALL_CHARACTERS = '';

/** Explored fog is not part of the undo history, so the DM confirms whose memory goes. */
function ResetExploredDialog({ onClose }: { onClose: () => void }) {
  const combatants = useEncounterStore((s) => s.encounter?.combatants ?? null);
  const characters = (combatants ?? []).filter((c) => c.side === 'player' || c.visionSource);
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const [chosen, setChosen] = useState(characters.some((c) => c.id === selectedId) ? selectedId! : ALL_CHARACTERS);
  const name = characters.find((c) => c.id === chosen)?.name;
  const reset = () => {
    useEncounterStore.getState().update((d) => {
      if (chosen === ALL_CHARACTERS) {
        d.fog.exploredBy = {};
      } else {
        delete d.fog.exploredBy[chosen];
      }
    });
    onClose();
  };
  return (
    <Dialog
      title="Reset explored areas"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button label="Reset" variant="danger" onClick={reset} />
        </>
      }
    >
      <SelectField
        label="Forget what was explored by"
        value={chosen}
        options={[ALL_CHARACTERS, ...characters.map((c) => c.id)]}
        format={(id) => (id === ALL_CHARACTERS ? 'All characters' : (characters.find((c) => c.id === id)?.name ?? id))}
        onChange={setChosen}
      />
      <p>
        {name === undefined
          ? 'Every character forgets the areas they have explored'
          : `${name} forgets the areas they have explored; the party still remembers what the others saw`}
        . What their tokens see now stays visible.
      </p>
    </Dialog>
  );
}

function FogPanel() {
  const showFog = useFogViewStore((s) => s.showFogToDm);
  const brush = useFogViewStore((s) => s.brush);
  const radius = useFogViewStore((s) => s.brushRadiusFt);
  const computeMs = useFogViewStore((s) => s.computeMs);
  const { setShowFogToDm, setBrush, setBrushRadius } = useFogViewStore.getState();
  const [resetting, setResetting] = useState(false);

  return (
    <div className="fog-panel" role="group" aria-label="Fog">
      <div className="row">
        <strong>Fog of war</strong>
        <div className="spacer" />
        <Button
          icon="close"
          label="Close fog menu"
          iconOnly
          variant="ghost"
          shortcut="F"
          onClick={() => useEncounterUi.setState({ fogMenuOpen: false })}
        />
      </div>
      <CheckboxField label="Show fog to DM" value={showFog} onChange={setShowFogToDm} />
      <div className="row" role="group" aria-label="Fog brush">
        {BRUSHES.map(({ mode, label, icon }) => (
          <Button
            key={mode}
            icon={icon}
            label={label}
            active={brush === mode}
            onClick={() => {
              if (mode !== 'off') cancelInteraction();
              setBrush(mode);
            }}
          />
        ))}
      </div>
      <SliderField
        label="Brush radius"
        value={radius}
        min={5}
        max={60}
        step={5}
        suffix=" ft"
        onChange={setBrushRadius}
      />
      <div className="row">
        <Button icon="undo" label="Reset explored" onClick={() => setResetting(true)} />
        <div className="spacer" />
        <span className="muted small">Visibility {computeMs === null ? '…' : `${Math.round(computeMs)} ms`}</span>
      </div>
      {resetting && <ResetExploredDialog onClose={() => setResetting(false)} />}
    </div>
  );
}

function UnplacedChip() {
  const count = useEncounterStore((s) => s.encounter?.combatants.filter((c) => c.position === null).length ?? 0);
  const firstId = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.position === null)?.id);
  const placingAll = useEncounterUi((s) => s.placingAll);
  return (
    firstId && (
      <Button
        className="unplaced-chip"
        icon="users"
        label={`${count} not on map`}
        title={placingAll ? 'Stop placing (Esc)' : 'Place them one after another'}
        active={placingAll}
        onClick={() => (placingAll ? cancelInteraction() : startPlacing(firstId, true))}
      />
    )
  );
}

function CanvasToolbar() {
  const tool = useEncounterUi((s) => s.tool);
  const camera = useEncounterUi((s) => s.camera);
  const placement = useEncounterUi((s) => s.placement);
  const fogMenuOpen = useEncounterUi((s) => s.fogMenuOpen);
  const brush = useFogViewStore((s) => s.brush);
  const pointerTool = brush === 'off' && placement === null;
  return (
    <div className="canvas-toolbar">
      <div className="canvas-group" role="toolbar" aria-label="Map tools">
        <ToolButton
          icon="cursor"
          label="Select"
          shortcut="S"
          active={pointerTool && tool === 'select'}
          onClick={() => chooseTool('select')}
        />
        <ToolButton
          icon="ruler"
          label="Measure"
          shortcut="M"
          active={pointerTool && tool === 'measure'}
          onClick={() => chooseTool('measure')}
        />
        <Popover
          label="Area templates"
          trigger={(open, toggle) => (
            <ToolButton icon="area" label="Area" active={open || placement !== null} onClick={toggle} />
          )}
        >
          {(close) => (
            <div className="area-popover">
              <AreaTemplatePicker onPick={close} />
            </div>
          )}
        </Popover>
      </div>
      <div className="canvas-group" role="toolbar" aria-label="Camera">
        <ToolButton
          icon="grid"
          label="Top"
          active={camera === 'top'}
          onClick={() => useEncounterUi.setState({ camera: 'top' })}
        />
        <ToolButton
          icon="cube"
          label="3D"
          active={camera === 'perspective'}
          onClick={() => useEncounterUi.setState({ camera: 'perspective' })}
        />
      </div>
      <div className="canvas-group" role="toolbar" aria-label="Fog">
        <ToolButton
          icon="fog"
          label="Fog"
          shortcut="F"
          active={fogMenuOpen || brush !== 'off'}
          onClick={() => useEncounterUi.setState({ fogMenuOpen: !fogMenuOpen })}
        />
      </div>
    </div>
  );
}

/** Battle map of Play with its toolbar, fog menu, unplaced tray chip, hint line and token context menu. */
export function PlayViewport({ map, terrain }: { map: BattleMap; terrain: HeightField }) {
  const reportError = useAppStore((s) => s.reportError);
  const camera = useEncounterUi((s) => s.camera);
  const fogMenuOpen = useEncounterUi((s) => s.fogMenuOpen);
  const showFog = useFogViewStore((s) => s.showFogToDm);
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const rightToken = useRef<string | null>(null);

  const onPointer = useCallback(
    (event: MapPointerEvent) => {
      try {
        if (event.type === 'down' && event.button === 2 && event.hit?.kind === 'token') {
          rightToken.current = event.hit.id;
        }
        if (!fogBrushPointer(event)) handleEncounterPointer(event);
      } catch (error) {
        reportError(error);
      }
    },
    [reportError],
  );

  // Capture phase runs before the canvas' own handler sets the token under the
  // pointer, so a right click on empty ground never reuses an older token.
  return (
    <div
      className="play-viewport"
      onPointerDownCapture={(e) => {
        if (e.button === 2) {
          rightDown.current = { x: e.clientX, y: e.clientY };
          rightToken.current = null;
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const start = rightDown.current;
        const still = start !== null && Math.hypot(e.clientX - start.x, e.clientY - start.y) < CLICK_SLOP_PX;
        if (still && rightToken.current) openCombatantMenu(rightToken.current, e.clientX, e.clientY);
      }}
    >
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
      <CanvasToolbar />
      {fogMenuOpen && <FogPanel />}
      <UnplacedChip />
      <ViewportHint />
    </div>
  );
}
