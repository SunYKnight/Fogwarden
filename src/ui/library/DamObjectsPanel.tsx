import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fitUnitFt, type DamCatalog } from '@/core/import/damCatalog';
import type { DamProject } from '@/core/import/damProject';
import { damObjectKinds, type DamObjectChoice, type DamObjectChoices } from '@/core/import/damObjects';
import type { MapImage } from '@/core/model';
import type { GridCalibration } from '@/core/terrain/calibration';
import {
  downloadPolyHaven,
  missingPolyHavenModels,
  plannedBytes,
  planPolyHaven,
  polyHavenStandIns,
} from '@/data/polyHaven';
import { useAppStore } from '@/state/appStore';
import { Button, confirmDialog } from '../kit';
import { loadDamCatalog, modelSize, projectChoices } from './daCatalog';
import {
  CC0_MODELS,
  damObjectPixels,
  importFolderModel,
  importModelFiles,
  listFolderModels,
  listLibraryModels,
  METERS_TO_FEET,
  type ModelOption,
} from './daObjects';

const SKIP = 'skip';
const OTHER_FILE = 'file';
const FOLDER_PREFIX = 'folder:';

/** The export's picture placed as the import will place it. */
export interface DamPreview {
  url: string;
  image: Pick<MapImage, 'widthPx' | 'heightPx'>;
  calibration: GridCalibration;
}

interface DamObjectsPanelProps {
  project: DamProject;
  /** Already completed by `choicesForProject`. */
  choices: DamObjectChoices;
  /** Null while the picture loads. */
  preview: DamPreview | null;
  onChange: (choices: DamObjectChoices) => void;
}

/**
 * One row per Dungeon Alchemist object kind: the DM picks a model (shipped CC0 stand-in, own
 * file, or a file from a folder such as Dungeon Alchemist's custom models) or skips the kind.
 * Names and sizes come from Dungeon Alchemist's own database when it is installed; the map
 * picture beside the table marks where the hovered or selected kind stands.
 */
export function DamObjectsPanel({ project, choices, preview, onChange }: DamObjectsPanelProps) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [library, setLibrary] = useState<ModelOption[]>([]);
  // Undefined while loading, null without a Dungeon Alchemist install.
  const [catalog, setCatalog] = useState<DamCatalog | null>();
  const [folderModels, setFolderModels] = useState<string[]>([]);
  const [polyHaven, setPolyHaven] = useState<ModelOption[]>([]);
  // Bytes done and total while the Poly Haven models download.
  const [download, setDownload] = useState<{ done: number; total: number } | null>(null);
  const [fileTarget, setFileTarget] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const kinds = useMemo(() => damObjectKinds(project), [project]);
  const [selected, setSelected] = useState(kinds[0]?.blockId ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = hovered ?? selected;
  const dots = useMemo(
    () => (preview && shown !== null ? damObjectPixels(project, shown, preview.image, preview.calibration) : []),
    [project, shown, preview],
  );
  const options = [...polyHaven, ...CC0_MODELS, ...library];

  // Models of the Poly Haven pack not downloaded yet; null while counting.
  const [missing, setMissing] = useState<number | null>(null);
  const refreshPolyHaven = useCallback(async () => {
    const [bySlot, count] = await Promise.all([polyHavenStandIns(repository), missingPolyHavenModels(repository)]);
    setPolyHaven(
      Object.values(bySlot)
        .flat()
        .map((model) => ({
          label: `${model.path.slice(model.path.lastIndexOf('/') + 1, -'.gltf'.length)} (Poly Haven)`,
          model,
          unitFt: METERS_TO_FEET,
        })),
    );
    setMissing(count);
  }, [repository]);
  useEffect(() => {
    listLibraryModels(repository).then(setLibrary, reportError);
    refreshPolyHaven().catch(reportError);
  }, [repository, reportError, refreshPolyHaven]);
  useEffect(() => {
    if (choices.modelFolder !== null && isTauri()) {
      listFolderModels(choices.modelFolder).then(setFolderModels, reportError);
    }
  }, [choices.modelFolder, reportError]);
  useEffect(() => {
    loadDamCatalog(choices.gameFolder).then(setCatalog, reportError);
  }, [choices.gameFolder, reportError]);

  const update = (blockId: string, patch: Partial<DamObjectChoice>) =>
    onChange({ ...choices, objects: { ...choices.objects, [blockId]: { ...choices.objects[blockId]!, ...patch } } });
  // Sized to the kind when Dungeon Alchemist's database knows its size.
  const assign = async (blockId: string, option: ModelOption) => {
    const sizeFt = catalog?.[blockId]?.sizeFt;
    const unitFt = sizeFt ? fitUnitFt(sizeFt, await modelSize(repository, option.model)) : option.unitFt;
    update(blockId, { model: option.model, unitFt });
  };
  const adoptModel = (blockId: string, option: ModelOption) => {
    setLibrary((l) => (l.some((o) => o.model.path === option.model.path) ? l : [...l, option]));
    return assign(blockId, option);
  };
  const select = (blockId: string, key: string) => {
    const option = options.find((o) => `${o.model.area}/${o.model.path}` === key);
    if (key === SKIP) {
      update(blockId, { model: null });
    } else if (key === OTHER_FILE) {
      setFileTarget(blockId);
      input.current?.click();
    } else if (key.startsWith(FOLDER_PREFIX)) {
      importFolderModel(repository, key.slice(FOLDER_PREFIX.length))
        .then((o) => adoptModel(blockId, o))
        .catch(reportError);
    } else if (option) {
      assign(blockId, option).catch(reportError);
    }
  };
  const locateGame = async () => {
    const folder = await open({ directory: true, title: 'Dungeon Alchemist folder' });
    if (folder !== null && (await loadDamCatalog(folder)) === null) {
      throw new Error(`"${folder}" is not Dungeon Alchemist's folder; choose the one with Dungeon Alchemist.exe`);
    }
    if (folder !== null) {
      onChange(await projectChoices(repository, project, { ...choices, gameFolder: folder }, false));
    }
  };
  const pickFolder = async () => {
    const folder = await open({ directory: true, title: 'Folder with glTF models' });
    if (folder !== null) {
      onChange({ ...choices, modelFolder: folder });
    }
  };
  const downloadPolyHavenModels = async () => {
    const plan = await planPolyHaven(repository);
    const total = plannedBytes(plan);
    const count = plan.filter((m) => m.needed).length;
    const ok = await confirmDialog({
      title: 'Download Poly Haven models',
      message:
        `${count} realistic plant, rock and furniture models (CC0, ${Math.round(total / 1e6)} MB) from ` +
        'polyhaven.com go into the pack "Poly Haven models"; Auto-assign then prefers them. ' +
        'Compendium > Packs removes them again.',
      confirmLabel: 'Download',
    });
    if (ok) {
      setDownload({ done: 0, total });
      try {
        await downloadPolyHaven(repository, plan, (done) => setDownload({ done, total }));
      } finally {
        setDownload(null);
      }
      await refreshPolyHaven();
      onChange(await projectChoices(repository, project, choices, true));
    }
  };

  return (
    <div className="col">
      <p className="muted">
        {project.objects.length} objects of {kinds.length} kinds. Dungeon Alchemist's own models stay in Dungeon
        Alchemist; pick a stand-in per kind. Choices are kept for later imports.
        {catalog === null && " Dungeon Alchemist wasn't found, so the kinds have no names."}
      </p>
      <div className="row">
        {catalog && (
          <Button
            icon="cube"
            label="Auto-assign stand-ins"
            title="Give every kind with a matching stand-in that model, sized as in Dungeon Alchemist"
            onClick={() => projectChoices(repository, project, choices, true).then(onChange, reportError)}
          />
        )}
        {catalog === null && isTauri() && (
          <Button icon="search" label="Locate Dungeon Alchemist…" onClick={() => locateGame().catch(reportError)} />
        )}
        {isTauri() && <Button icon="folder" label="Model folder…" onClick={() => pickFolder().catch(reportError)} />}
        {missing !== null && missing > 0 && (
          <Button
            icon="upload"
            label={
              download
                ? `Downloading… ${Math.round((100 * download.done) / Math.max(download.total, 1))}%`
                : 'Get realistic models…'
            }
            title="Download CC0 plants, rocks and furniture from Poly Haven"
            disabled={download !== null}
            onClick={() => downloadPolyHavenModels().catch(reportError)}
          />
        )}
        {choices.modelFolder !== null && <span className="muted portrait-folder">{choices.modelFolder}</span>}
      </div>
      <div className="dam-objects-layout">
        <div className="dam-objects-scroll">
          <table className="table dam-objects">
            <thead>
              <tr>
                <th>Name</th>
                <th>Count</th>
                <th>Model</th>
                <th
                  title={
                    'Feet per model unit: 5 for models made for Dungeon Alchemist (one unit is one square), ' +
                    '3.28 for models in meters'
                  }
                >
                  Size
                </th>
                <th title="Added rotation, degrees clockwise">Rotate</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map(({ blockId, count }) => {
                const choice = choices.objects[blockId]!;
                return (
                  <tr
                    key={blockId}
                    className={blockId === selected ? 'selected' : undefined}
                    onClick={() => setSelected(blockId)}
                    onFocus={() => setSelected(blockId)}
                    onMouseEnter={() => setHovered(blockId)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <td>
                      <input
                        value={choice.name}
                        title={blockId}
                        aria-label="Name"
                        onChange={(e) => update(blockId, { name: e.target.value })}
                      />
                    </td>
                    <td>{count}</td>
                    <td>
                      <select
                        value={choice.model ? `${choice.model.area}/${choice.model.path}` : SKIP}
                        aria-label={`Model for ${choice.name}`}
                        onChange={(e) => select(blockId, e.target.value)}
                      >
                        <option value={SKIP}>Skip</option>
                        {options.map((o) => (
                          <option key={o.model.path} value={`${o.model.area}/${o.model.path}`}>
                            {o.model.area === 'content' ? `${o.label} (CC0)` : o.label}
                          </option>
                        ))}
                        {folderModels.map((path) => (
                          <option key={path} value={`${FOLDER_PREFIX}${path}`}>
                            {path.slice((choices.modelFolder ?? '').length + 1)}
                          </option>
                        ))}
                        <option value={OTHER_FILE}>Choose file…</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0.01}
                        step={0.1}
                        value={choice.unitFt}
                        aria-label="Size in feet per model unit"
                        onChange={(e) => update(blockId, { unitFt: Number(e.target.value) || choice.unitFt })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={15}
                        value={choice.rotationDeg}
                        aria-label="Rotate, degrees clockwise"
                        onChange={(e) => update(blockId, { rotationDeg: Number(e.target.value) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <figure className="dam-preview">
          {preview ? (
            <div className="dam-preview-stage">
              <img src={preview.url} alt="Map picture" draggable={false} />
              <svg viewBox={`0 0 ${preview.image.widthPx} ${preview.image.heightPx}`} aria-hidden="true">
                {dots.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={Math.max(preview.image.widthPx, preview.image.heightPx) / 120}
                    className="dam-preview-dot"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            </div>
          ) : (
            <p className="muted">Loading the map picture…</p>
          )}
          <figcaption className="muted">
            {shown !== null
              ? `${choices.objects[shown]!.name}: ${dots.length} marked`
              : 'Point at a row to see where its objects stand.'}
          </figcaption>
        </figure>
      </div>
      <input
        ref={input}
        type="file"
        accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (fileTarget !== null && files.length > 0) {
            importModelFiles(repository, files)
              .then((o) => adoptModel(fileTarget, o))
              .catch(reportError);
          }
        }}
      />
    </div>
  );
}
