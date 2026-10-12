import { SIDE_MATERIALS, lightLevelSchema } from '@/core/model';
import { GridFields } from '@/editor/tools/terrain/calibrate';
import { useEditorStore } from '@/state/editorStore';
import { ColorField, NumberField, SelectField, TextField } from '../components/fields';
import { Button, Dialog, Section } from '../kit';

// Stable identity: the dialog re-focuses its first field when onClose changes.
const close = () => useEditorStore.getState().setSettingsOpen(false);

/** Everything about the map as a whole: name, grid calibration, lighting and ground. */
export function MapSettingsDialog() {
  const map = useEditorStore((s) => s.map);
  const edit = useEditorStore((s) => s.edit);
  if (!map) {
    throw new Error('MapSettingsDialog needs an open map');
  }
  return (
    <Dialog
      title="Map settings"
      onClose={close}
      width={560}
      footer={<Button label="Done" variant="primary" onClick={close} />}
    >
      <Section title="Map">
        <TextField label="Name" value={map.name} onChange={(v) => edit('Rename map', (d) => void (d.name = v))} />
        <TextField
          label="Tags"
          value={map.tags.join(', ')}
          placeholder="comma separated"
          onChange={(v) =>
            edit('Edit tags', (d) => {
              d.tags = v
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t.length > 0);
            })
          }
        />
        <TextField
          label="Notes"
          multiline
          value={map.notes}
          onChange={(v) => edit('Map notes', (d) => void (d.notes = v))}
        />
      </Section>
      <Section title="Grid">
        <GridFields />
      </Section>
      <Section title="Lighting and ground">
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
      </Section>
    </Dialog>
  );
}
