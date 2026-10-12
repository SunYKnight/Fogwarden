import { SIDE_MATERIALS, lightLevelSchema } from '@/core/model';
import { useEditorStore } from '@/state/editorStore';
import { CheckboxField, ColorField, NumberField, SelectField, SliderField, TextField } from '../components/fields';

export function MapPropertiesPanel() {
  const map = useEditorStore((s) => s.map);
  const edit = useEditorStore((s) => s.edit);
  if (!map) {
    throw new Error('MapPropertiesPanel needs an open map');
  }
  return (
    <div className="panel">
      <h2>Map</h2>
      <TextField label="Name" value={map.name} onChange={(v) => edit('Rename map', (d) => void (d.name = v))} />
      <TextField
        label="Tags"
        value={map.tags.join(', ')}
        onChange={(v) =>
          edit('Edit tags', (d) => {
            d.tags = v
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t.length > 0);
          })
        }
      />
      <SelectField
        label="Ambient light"
        value={map.ambientLight}
        options={lightLevelSchema.options}
        onChange={(v) => edit('Ambient light', (d) => void (d.ambientLight = v))}
      />
      <CheckboxField
        label="Show grid"
        value={map.grid.show}
        onChange={(v) => edit('Toggle grid', (d) => void (d.grid.show = v))}
      />
      <ColorField
        label="Grid color"
        value={map.grid.color}
        onChange={(v) => edit('Grid color', (d) => void (d.grid.color = v))}
      />
      <SliderField
        label="Grid opacity"
        value={map.grid.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => edit('Grid opacity', (d) => void (d.grid.opacity = v))}
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
      <TextField
        label="Notes"
        multiline
        value={map.notes}
        onChange={(v) => edit('Map notes', (d) => void (d.notes = v))}
      />
    </div>
  );
}
