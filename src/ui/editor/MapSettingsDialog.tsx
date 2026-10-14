import { useRef, useState, type ComponentType } from 'react';
import { isVideoFile, mediaTitle, VIDEO_ACCEPT } from '@/core/atmosphere/media';
import { imageSize } from '@/core/imageSize';
import { SIDE_MATERIALS, lightLevelSchema } from '@/core/model';
import { GridFields } from '@/editor/tools/terrain/calibrate';
import { useAppStore } from '@/state/appStore';
import { useEditorStore, type MapSettingsTab } from '@/state/editorStore';
import { ColorField, NumberField, SelectField, TextField } from '../components/fields';
import { ListField } from '../creature/creatureFields';
import { Button, Dialog, Section, Tabs, type TabSpec } from '../kit';

const SETTINGS_TABS: TabSpec<MapSettingsTab>[] = [
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'grid', label: 'Grid', icon: 'grid' },
  { id: 'lighting', label: 'Lighting & ground', icon: 'sun' },
];

const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp';

function videoSize(file: File): Promise<{ widthPx: number; heightPx: number }> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  const { promise, resolve, reject } = Promise.withResolvers<{ widthPx: number; heightPx: number }>();
  video.preload = 'metadata';
  video.onloadedmetadata = () => resolve({ widthPx: video.videoWidth, heightPx: video.videoHeight });
  video.onerror = () => reject(new Error(`${file.name} is not a video this app can play`));
  video.src = url;
  return promise.finally(() => URL.revokeObjectURL(url));
}

/**
 * Swaps the battlemap for another picture or a looping video (MP4/WebM). The grid scales with the pixel
 * size, so the same map in another resolution, e.g. its animated version, stays calibrated.
 */
function BattlemapFields() {
  const map = useEditorStore((s) => s.map);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const replace = async (file: File) => {
    const { repository, notify } = useAppStore.getState();
    const { map: current, edit } = useEditorStore.getState();
    if (!current) {
      throw new Error('No map is open');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = isVideoFile(file.name) ? await videoSize(file) : imageSize(bytes);
    const asset = await repository.importMapAsset(current.id, file.name, bytes);
    edit('Replace battlemap', (d) => {
      const scale = d.image ? size.widthPx / d.image.widthPx : 1;
      d.grid.pxPerSquare *= scale;
      d.grid.offsetPx = { x: d.grid.offsetPx.x * scale, y: d.grid.offsetPx.y * scale };
      d.image = { asset, ...size };
    });
    notify(isVideoFile(file.name) ? 'Battlemap is now a video' : 'Battlemap replaced');
  };
  return (
    <div className="row">
      <span className="muted">{map?.image ? mediaTitle(map.image.asset.path) : 'No battlemap'}</span>
      <div className="spacer" />
      <Button
        icon="upload"
        label={busy ? 'Copying…' : 'Replace with picture or video…'}
        disabled={busy}
        onClick={() => input.current?.click()}
      />
      <input
        ref={input}
        type="file"
        accept={`${PICTURE_ACCEPT},${VIDEO_ACCEPT}`}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            setBusy(true);
            replace(file)
              .catch(useAppStore.getState().reportError)
              .finally(() => setBusy(false));
          }
        }}
      />
    </div>
  );
}

function MapFields() {
  const map = useEditorStore((s) => s.map);
  const edit = useEditorStore((s) => s.edit);
  if (!map) {
    throw new Error('MapFields needs an open map');
  }
  return (
    <>
      <TextField label="Name" value={map.name} onChange={(v) => edit('Rename map', (d) => void (d.name = v))} />
      <ListField label="Tags" value={map.tags} onChange={(v) => edit('Edit tags', (d) => void (d.tags = v))} />
      <TextField
        label="Notes"
        multiline
        value={map.notes}
        onChange={(v) => edit('Map notes', (d) => void (d.notes = v))}
      />
      <Section title="Battlemap">
        <BattlemapFields />
      </Section>
    </>
  );
}

function LightingFields() {
  const map = useEditorStore((s) => s.map);
  const edit = useEditorStore((s) => s.edit);
  if (!map) {
    throw new Error('LightingFields needs an open map');
  }
  return (
    <>
      <SelectField
        label="Ambient light"
        value={map.ambientLight}
        options={lightLevelSchema.options}
        onChange={(v) => edit('Ambient light', (d) => void (d.ambientLight = v))}
      />
      <ColorField
        label="Ground color"
        value={map.terrain.baseColor}
        onChange={(v) => edit('Ground color', (d) => void (d.terrain.baseColor = v))}
      />
      <SelectField
        label="Cliff material"
        value={map.terrain.cliffMaterial}
        options={SIDE_MATERIALS}
        onChange={(v) => edit('Cliff material', (d) => void (d.terrain.cliffMaterial = v))}
      />
      <NumberField
        label="Cliff from"
        value={map.terrain.cliffSlopeDeg}
        min={10}
        max={89}
        suffix="°"
        title="Slopes steeper than this show the cliff material instead of the battlemap"
        onChange={(v) => edit('Cliff slope', (d) => void (d.terrain.cliffSlopeDeg = v))}
      />
    </>
  );
}

const TAB_BODIES: Record<MapSettingsTab, ComponentType> = {
  map: MapFields,
  grid: GridFields,
  lighting: LightingFields,
};

/** Everything about the map as a whole: name, battlemap, grid calibration, lighting and ground. */
export function MapSettingsDialog() {
  const tab = useEditorStore((s) => s.settingsTab);
  const setTab = useEditorStore((s) => s.setSettingsTab);
  const Body = TAB_BODIES[tab];
  const close = () => useEditorStore.getState().setSettingsOpen(false);
  return (
    <Dialog
      title="Map settings"
      onClose={close}
      width={560}
      footer={<Button label="Done" variant="primary" onClick={close} />}
    >
      <Tabs tabs={SETTINGS_TABS} value={tab} onChange={setTab} label="Map settings" />
      <div className="map-settings-body">
        <Body />
      </div>
    </Dialog>
  );
}
