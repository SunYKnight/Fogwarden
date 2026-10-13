import type { GraphicsSettings, Settings } from '@/core/model';
import { CheckboxField, SliderField } from '../components/fields';
import { Button, Section } from '../kit';

const PRESET_NAMES = ['Low', 'Medium', 'High'] as const;
type Preset = (typeof PRESET_NAMES)[number];

const PRESETS: Record<Preset, GraphicsSettings> = {
  Low: { shadowedLights: 0, resolutionScale: 0.5, propShadows: false },
  Medium: { shadowedLights: 2, resolutionScale: 0.75, propShadows: true },
  High: { shadowedLights: 8, resolutionScale: 1, propShadows: true },
};

const INTEGRATED_GPU = /Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|Apple GPU/i;

// Every context costs GPU memory, so the renderer is read once per window.
let detectedRenderer: string | null | undefined;

/** Renderer name the driver reports, or null when WebGL or the name is unavailable. */
function gpuRenderer(): string | null {
  if (detectedRenderer === undefined) {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
    detectedRenderer = typeof name === 'string' ? name : null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return detectedRenderer;
}

/** Shadow and resolution limits of the 3D views, with presets and one suggested for this GPU. */
export function GraphicsSection({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const graphics = settings.graphics;
  const renderer = gpuRenderer();
  const suggested: Preset = renderer !== null && INTEGRATED_GPU.test(renderer) ? 'Low' : 'High';
  const update = (patch: Partial<GraphicsSettings>) => save({ ...settings, graphics: { ...graphics, ...patch } });

  return (
    <Section title="Graphics">
      <p className="muted small">
        Graphics card: {renderer ?? 'unknown'}. Suggested preset: {suggested}.
      </p>
      <div className="row wrap">
        {PRESET_NAMES.map((preset) => (
          <Button
            key={preset}
            label={preset === suggested ? `${preset} (suggested)` : preset}
            onClick={() => save({ ...settings, graphics: PRESETS[preset] })}
          />
        ))}
      </div>
      <Section title="Advanced" collapsible defaultOpen={false}>
        <SliderField
          label="Lights with shadows"
          value={graphics.shadowedLights}
          min={0}
          max={8}
          step={1}
          onChange={(shadowedLights) => update({ shadowedLights })}
        />
        <SliderField
          label="Resolution"
          value={Math.round(graphics.resolutionScale * 100)}
          min={50}
          max={100}
          step={5}
          suffix="%"
          onChange={(v) => update({ resolutionScale: v / 100 })}
        />
        <CheckboxField
          label="Props cast shadows"
          value={graphics.propShadows}
          onChange={(propShadows) => update({ propShadows })}
        />
      </Section>
    </Section>
  );
}
