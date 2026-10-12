import { useFogViewStore, type FogBrushMode } from '@/render/fog/fogViewStore';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useDmCameraStore } from '@/sync/cameraStore';
import { CheckboxField, SelectField, SliderField } from '../components/fields';
import { openPlayerWindow } from '../playerWindow';

const BRUSH_LABEL: Record<FogBrushMode, string> = {
  off: 'Off',
  reveal: 'Reveal',
  hide: 'Hide',
  erase: 'Erase reveal/hide',
};
const BRUSH_MODES = Object.keys(BRUSH_LABEL) as FogBrushMode[];

/** Player window, camera push and the DM's fog tools for the open encounter. */
export function PlayerViewPanel() {
  const settings = useAppStore((s) => s.settings);
  const reportError = useAppStore((s) => s.reportError);
  const push = useDmCameraStore((s) => s.push);
  const setPush = useDmCameraStore((s) => s.setPush);
  const showFog = useFogViewStore((s) => s.showFogToDm);
  const setShowFog = useFogViewStore((s) => s.setShowFogToDm);
  const brush = useFogViewStore((s) => s.brush);
  const setBrush = useFogViewStore((s) => s.setBrush);
  const radius = useFogViewStore((s) => s.brushRadiusFt);
  const setRadius = useFogViewStore((s) => s.setBrushRadius);
  const computeMs = useFogViewStore((s) => s.computeMs);
  const hasMap = useEncounterStore((s) => s.map !== null);

  const resetExplored = () =>
    useEncounterStore.getState().update((draft) => {
      draft.fog.explored = '';
    });

  return (
    <div className="col">
      <button disabled={!settings} onClick={() => settings && openPlayerWindow(settings).catch(reportError)}>
        Open player window
      </button>
      <CheckboxField label="Push camera" value={push} onChange={setPush} />
      <CheckboxField label="Show fog to DM" value={showFog} onChange={setShowFog} />
      <SelectField
        label="Fog brush"
        value={brush}
        options={BRUSH_MODES}
        format={(mode) => BRUSH_LABEL[mode]}
        onChange={setBrush}
      />
      <SliderField label="Brush radius" value={radius} min={5} max={60} step={5} suffix=" ft" onChange={setRadius} />
      <button disabled={!hasMap} onClick={resetExplored}>
        Reset explored
      </button>
      <span className="muted">
        {hasMap
          ? `Visibility: ${computeMs === null ? '…' : `${Math.round(computeMs)} ms`}`
          : 'The encounter has no map.'}
      </span>
    </div>
  );
}
