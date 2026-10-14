import { useRef, useState } from 'react';
import { AUDIO_ACCEPT, mediaTitle } from '@/core/atmosphere/media';
import {
  OPENING_KINDS,
  REGION_KINDS,
  SIDE_MATERIALS,
  lightLevelSchema,
  openingStateSchema,
  type MapLight,
  type Opening,
  type Region,
  type RegionSound,
  type Room,
  type Wall,
} from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useEditorStore } from '@/state/editorStore';
import { CheckboxField, ColorField, NumberField, SelectField, SliderField } from '@/ui/components/fields';
import { Button } from '@/ui/kit';

/** Field changes carry an undo label so tool templates and documents can share the editors. */
type Change<T> = (label: string, patch: Partial<T>) => void;

export type WallTemplate = Omit<Wall, 'id' | 'points' | 'closed'>;
export type OpeningTemplate = Omit<Opening, 'id' | 'wallId' | 'segment' | 't'>;
export type RoomTemplate = Omit<Room, 'id' | 'name' | 'polygon'>;
export type RegionTemplate = Omit<Region, 'id' | 'name' | 'polygon' | 'notes'>;
export type LightTemplate = Pick<MapLight, 'brightFt' | 'dimFt' | 'color' | 'enabled'>;

/** Size of a new opening by kind; arrow slits are narrow holes, windows sit above a sill. */
export const OPENING_DEFAULTS: Record<Opening['kind'], Pick<Opening, 'widthFt' | 'heightFt' | 'sillFt'>> = {
  door: { widthFt: 5, heightFt: 7, sillFt: 0 },
  window: { widthFt: 3, heightFt: 3, sillFt: 3 },
  portcullis: { widthFt: 5, heightFt: 8, sillFt: 0 },
  'arrow-slit': { widthFt: 0.5, heightFt: 3, sillFt: 3 },
};

export const REGION_COLORS: Record<Region['kind'], string> = {
  light: '#f2c94c',
  difficult: '#a0522d',
  water: '#3d8bfd',
  hazard: '#e74c3c',
  note: '#9b59b6',
  sound: '#1abc9c',
};

const DEFAULT_REGION_SOUND: RegionSound = { asset: null, radiusFt: 20, volume: 0.8 };

/** Region kind change with the matching default color, light level and ambient sound. */
function regionKindPatch(kind: Region['kind'], current: RegionTemplate): Partial<RegionTemplate> {
  return {
    kind,
    color: REGION_COLORS[kind],
    light: kind === 'light' ? (current.light ?? 'darkness') : null,
    sound: kind === 'sound' ? (current.sound ?? DEFAULT_REGION_SOUND) : null,
  };
}

/** Ambient loop of a sound region: the file (copied into the map's assets), fade distance and volume. */
function RegionSoundFields({ sound, onChange }: { sound: RegionSound; onChange: Change<RegionTemplate> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File) => {
    const map = useEditorStore.getState().map;
    if (!map) {
      throw new Error('No map is open');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await useAppStore.getState().repository.importMapAsset(map.id, file.name, bytes);
    onChange('Region sound', { sound: { ...sound, asset } });
  };
  return (
    <>
      <Button
        icon="music"
        label={busy ? 'Copying…' : sound.asset ? mediaTitle(sound.asset.path) : 'Choose sound…'}
        title="Audio file that loops while the party is near (MP3, OGG, WAV, M4A)"
        disabled={busy}
        onClick={() => input.current?.click()}
      />
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            setBusy(true);
            pick(file)
              .catch(useAppStore.getState().reportError)
              .finally(() => setBusy(false));
          }
        }}
      />
      <NumberField
        label="Heard within"
        value={sound.radiusFt}
        min={0}
        step={5}
        suffix="ft"
        title="Full volume inside the area, fading to silence this far beyond its edge"
        onChange={(radiusFt) => onChange('Sound distance', { sound: { ...sound, radiusFt } })}
      />
      <SliderField
        label="Volume"
        value={Math.round(sound.volume * 100)}
        min={0}
        max={100}
        step={5}
        suffix="%"
        onChange={(percent) => onChange('Sound volume', { sound: { ...sound, volume: percent / 100 } })}
      />
    </>
  );
}

/** Number that may be null ("follow terrain"); unchecking starts from `fallback`. */
function NullableNumberField(props: {
  label: string;
  nullLabel: string;
  value: number | null;
  fallback: number;
  onChange: (value: number | null) => void;
}) {
  const { label, nullLabel, value, fallback, onChange } = props;
  return (
    <>
      <CheckboxField label={nullLabel} value={value === null} onChange={(v) => onChange(v ? null : fallback)} />
      {value !== null && <NumberField label={label} value={value} step={0.5} suffix="ft" onChange={onChange} />}
    </>
  );
}

export function WallFields({ value, onChange }: { value: WallTemplate; onChange: Change<WallTemplate> }) {
  return (
    <>
      <NumberField
        label="Height"
        value={value.heightFt}
        min={0.5}
        step={0.5}
        suffix="ft"
        onChange={(heightFt) => onChange('Wall height', { heightFt })}
      />
      <NumberField
        label="Thickness"
        value={value.thicknessFt}
        min={0.1}
        step={0.25}
        suffix="ft"
        onChange={(thicknessFt) => onChange('Wall thickness', { thicknessFt })}
      />
      <NullableNumberField
        label="Base"
        nullLabel="Follow terrain"
        value={value.baseFt}
        fallback={0}
        onChange={(baseFt) => onChange('Wall base', { baseFt })}
      />
      <SelectField
        label="Material"
        value={value.material}
        options={SIDE_MATERIALS}
        onChange={(material) => onChange('Wall material', { material })}
      />
      <CheckboxField
        label="Blocks sight"
        value={value.blocksSight}
        onChange={(blocksSight) => onChange('Wall blocks sight', { blocksSight })}
      />
      <CheckboxField
        label="Blocks movement"
        value={value.blocksMovement}
        onChange={(blocksMovement) => onChange('Wall blocks movement', { blocksMovement })}
      />
      <CheckboxField
        label="Blocks light"
        value={value.blocksLight}
        onChange={(blocksLight) => onChange('Wall blocks light', { blocksLight })}
      />
    </>
  );
}

export function OpeningFields({ value, onChange }: { value: OpeningTemplate; onChange: Change<OpeningTemplate> }) {
  return (
    <>
      <SelectField
        label="Kind"
        value={value.kind}
        options={OPENING_KINDS}
        onChange={(kind) => onChange('Opening kind', { kind })}
      />
      <SelectField
        label="State"
        value={value.state}
        options={openingStateSchema.options}
        onChange={(state) => onChange('Opening state', { state })}
      />
      <CheckboxField
        label="Secret"
        value={value.secret}
        onChange={(secret) => onChange('Secret opening', { secret })}
      />
      <NumberField
        label="Width"
        value={value.widthFt}
        min={0.1}
        step={0.5}
        suffix="ft"
        onChange={(widthFt) => onChange('Opening width', { widthFt })}
      />
      <NumberField
        label="Height"
        value={value.heightFt}
        min={0.1}
        step={0.5}
        suffix="ft"
        onChange={(heightFt) => onChange('Opening height', { heightFt })}
      />
      <NumberField
        label="Sill"
        value={value.sillFt}
        min={0}
        step={0.5}
        suffix="ft"
        onChange={(sillFt) => onChange('Opening sill', { sillFt })}
      />
    </>
  );
}

export function RoomFields({ value, onChange }: { value: RoomTemplate; onChange: Change<RoomTemplate> }) {
  return (
    <>
      <NullableNumberField
        label="Floor"
        nullLabel="Terrain floor"
        value={value.floorFt}
        fallback={0}
        onChange={(floorFt) => onChange('Room floor', { floorFt })}
      />
      <NumberField
        label="Ceiling"
        value={value.ceilingFt}
        min={1}
        step={0.5}
        suffix="ft"
        onChange={(ceilingFt) => onChange('Room ceiling', { ceilingFt })}
      />
      <CheckboxField label="Roof" value={value.roof} onChange={(roof) => onChange('Room roof', { roof })} />
      <SelectField
        label="Roof material"
        value={value.roofMaterial}
        options={SIDE_MATERIALS}
        onChange={(roofMaterial) => onChange('Roof material', { roofMaterial })}
      />
    </>
  );
}

export function RegionFields({ value, onChange }: { value: RegionTemplate; onChange: Change<RegionTemplate> }) {
  return (
    <>
      <SelectField
        label="Kind"
        value={value.kind}
        options={REGION_KINDS}
        onChange={(kind) => onChange('Region kind', regionKindPatch(kind, value))}
      />
      {value.kind === 'light' && (
        <SelectField
          label="Light level"
          value={value.light ?? 'darkness'}
          options={lightLevelSchema.options}
          onChange={(light) => onChange('Region light', { light })}
        />
      )}
      {value.kind === 'sound' && <RegionSoundFields sound={value.sound ?? DEFAULT_REGION_SOUND} onChange={onChange} />}
      <ColorField label="Color" value={value.color} onChange={(color) => onChange('Region color', { color })} />
      <CheckboxField
        label="Hidden from players"
        value={value.hiddenFromPlayers}
        onChange={(hiddenFromPlayers) => onChange('Hide region', { hiddenFromPlayers })}
      />
    </>
  );
}

export function LightFields({ value, onChange }: { value: LightTemplate; onChange: Change<LightTemplate> }) {
  return (
    <>
      <NumberField
        label="Bright"
        value={value.brightFt}
        min={0}
        step={5}
        suffix="ft"
        onChange={(brightFt) => onChange('Bright radius', { brightFt })}
      />
      <NumberField
        label="Dim (beyond)"
        value={value.dimFt}
        min={0}
        step={5}
        suffix="ft"
        title="Dim light reaches this far beyond the bright radius"
        onChange={(dimFt) => onChange('Dim radius', { dimFt })}
      />
      <ColorField label="Color" value={value.color} onChange={(color) => onChange('Light color', { color })} />
      <CheckboxField label="On" value={value.enabled} onChange={(enabled) => onChange('Toggle light', { enabled })} />
    </>
  );
}
