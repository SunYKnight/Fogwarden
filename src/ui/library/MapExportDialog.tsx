import { useState } from 'react';
import type { BattleMap } from '@/core/model';
import type { HeightField } from '@/core/terrain/heightfield';
import { useAppStore } from '@/state/appStore';
import { CheckboxField } from '../components/fields';
import { Button, Dialog, Icon } from '../kit';
import { exportMap, MAP_EXPORT_FORMATS, type MapExportFormat } from './mapExport';

interface MapExportDialogProps {
  name: string;
  /** The map as it should be exported: the saved one, or the editor's live state. */
  load: () => Promise<{ map: BattleMap; terrain: HeightField }>;
  onClose: () => void;
}

/** Export as 3D model, Universal VTT or image; the save dialog picks the file. */
export function MapExportDialog({ name, load, onClose }: MapExportDialogProps) {
  const reportError = useAppStore((s) => s.reportError);
  const [format, setFormat] = useState<MapExportFormat>('glb');
  const [lights, setLights] = useState(true);
  const [grid, setGrid] = useState(true);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { map, terrain } = await load();
      if (await exportMap(map, terrain, format, { lights, grid })) onClose();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Export "${name}"`}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            icon="download"
            label={busy ? 'Exporting…' : 'Export…'}
            variant="primary"
            disabled={busy}
            onClick={() => void run()}
          />
        </>
      }
    >
      <div className="export-formats" role="radiogroup" aria-label="Format">
        {Object.entries(MAP_EXPORT_FORMATS).map(([id, info]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={format === id}
            className={format === id ? 'export-format active' : 'export-format'}
            onClick={() => setFormat(id as MapExportFormat)}
          >
            <Icon name={info.icon} size={22} />
            <strong>
              {info.label} (.{info.extension})
            </strong>
            <span className="muted">{info.description}</span>
          </button>
        ))}
      </div>
      {format === 'glb' && <CheckboxField label="Include lights" value={lights} onChange={setLights} />}
      {format === 'png' && <CheckboxField label="Show grid" value={grid} onChange={setGrid} />}
    </Dialog>
  );
}
