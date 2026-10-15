import {
  graphicsSettingsSchema,
  SHADOW_MAP_SIZES_PX,
  TEXTURE_SIZES_PX,
  type GraphicsSettings,
  type Settings,
} from '@/core/model';
import { MAX_TEXTURE_PX } from '@/render/loadImageTexture';
import { textureMemoryMiB } from '@/render/textureLimits';
import { CheckboxField, SelectField, SliderField } from '../components/fields';
import { Button, Section } from '../kit';

const PRESET_NAMES = ['Low', 'Medium', 'High'] as const;
type Preset = (typeof PRESET_NAMES)[number];

const PRESETS: Record<Preset, GraphicsSettings> = {
  Low: {
    shadowedLights: 0,
    resolutionScale: 0.5,
    propShadows: false,
    textureSizePx: 1024,
    shadowMapSizePx: 256,
    antialias: false,
    maxFps: 15,
  },
  Medium: {
    shadowedLights: 2,
    resolutionScale: 0.75,
    propShadows: true,
    textureSizePx: 2048,
    shadowMapSizePx: 512,
    antialias: true,
    maxFps: 30,
  },
  High: {
    shadowedLights: 8,
    resolutionScale: 1,
    propShadows: true,
    textureSizePx: 4096,
    shadowMapSizePx: 512,
    antialias: true,
    maxFps: null,
  },
};

const FRAME_RATES = ['unlimited', '30', '15'] as const;
type FrameRate = (typeof FRAME_RATES)[number];

const MAX_FPS: Record<FrameRate, GraphicsSettings['maxFps']> = { unlimited: null, '30': 30, '15': 15 };
const FRAME_RATE_LABEL: Record<FrameRate, string> = { unlimited: 'Unlimited', '30': '30 fps', '15': '15 fps' };

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

/** Render cost limits of the 3D views, with presets and one suggested for this GPU. */
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
        <SelectField
          label="Texture size"
          value={String(graphics.textureSizePx)}
          options={TEXTURE_SIZES_PX.map(String)}
          format={(v) => `${v} px`}
          onChange={(v) => update({ textureSizePx: graphicsSettingsSchema.shape.textureSizePx.parse(Number(v)) })}
        />
        <p className="muted small">
          Longest edge of battlemaps, token pictures and 3D model textures; exports keep full size. A square battlemap
          saves about {Math.round(textureMemoryMiB(MAX_TEXTURE_PX) - textureMemoryMiB(graphics.textureSizePx))} MB of
          graphics memory compared with {MAX_TEXTURE_PX} px.
        </p>
        <SelectField
          label="Shadow quality"
          value={String(graphics.shadowMapSizePx)}
          options={SHADOW_MAP_SIZES_PX.map(String)}
          format={(v) => `${v} px`}
          onChange={(v) => update({ shadowMapSizePx: graphicsSettingsSchema.shape.shadowMapSizePx.parse(Number(v)) })}
        />
        <p className="muted small">Size of each light&apos;s shadow maps; smaller is faster but blurrier.</p>
        <CheckboxField
          label="Antialiasing"
          value={graphics.antialias}
          onChange={(antialias) => update({ antialias })}
        />
        <p className="muted small">Smooths jagged edges at some cost; the 3D view restarts when it changes.</p>
        <SelectField
          label="Frame rate limit"
          value={FRAME_RATES.find((rate) => MAX_FPS[rate] === graphics.maxFps) ?? 'unlimited'}
          options={FRAME_RATES}
          format={(v) => FRAME_RATE_LABEL[v]}
          onChange={(v) => update({ maxFps: MAX_FPS[v] })}
        />
        <p className="muted small">
          30 fps halves the work of the graphics card on most screens, 15 fps quarters it (moves look less smooth).
        </p>
      </Section>
    </Section>
  );
}
