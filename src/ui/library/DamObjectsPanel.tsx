import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DamProject } from '@/core/import/damProject';
import { damObjectKinds, type DamObjectChoice, type DamObjectChoices } from '@/core/import/damObjects';
import { useAppStore } from '@/state/appStore';
import { Button } from '../kit';
import {
  CC0_MODELS,
  DA_UNIT_FT,
  importFolderModel,
  importModelFiles,
  listFolderModels,
  listLibraryModels,
  type ModelOption,
} from './daObjects';

const SKIP = 'skip';
const OTHER_FILE = 'file';
const FOLDER_PREFIX = 'folder:';

/** Every kept choice for the project's kinds, with a skip entry for kinds never seen before. */
export function choicesForProject(project: DamProject, choices: DamObjectChoices): DamObjectChoices {
  const objects = { ...choices.objects };
  damObjectKinds(project).forEach(({ blockId }) => {
    objects[blockId] ??= { name: `Object ${blockId.slice(0, 8)}`, model: null, unitFt: DA_UNIT_FT, rotationDeg: 0 };
  });
  return { ...choices, objects };
}

interface DamObjectsPanelProps {
  project: DamProject;
  /** Already completed by `choicesForProject`. */
  choices: DamObjectChoices;
  onChange: (choices: DamObjectChoices) => void;
}

/**
 * One row per Dungeon Alchemist object kind: the DM picks a model (shipped CC0 stand-in, own
 * file, or a file from a folder such as Dungeon Alchemist's custom models) or skips the kind.
 */
export function DamObjectsPanel({ project, choices, onChange }: DamObjectsPanelProps) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [library, setLibrary] = useState<ModelOption[]>([]);
  const [folderModels, setFolderModels] = useState<string[]>([]);
  const [fileTarget, setFileTarget] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const kinds = useMemo(() => damObjectKinds(project), [project]);
  const options = [...CC0_MODELS, ...library];

  useEffect(() => {
    listLibraryModels(repository).then(setLibrary, reportError);
  }, [repository, reportError]);
  useEffect(() => {
    if (choices.modelFolder !== null && isTauri()) {
      listFolderModels(choices.modelFolder).then(setFolderModels, reportError);
    }
  }, [choices.modelFolder, reportError]);

  const update = (blockId: string, patch: Partial<DamObjectChoice>) =>
    onChange({ ...choices, objects: { ...choices.objects, [blockId]: { ...choices.objects[blockId]!, ...patch } } });
  const adoptModel = (blockId: string, option: ModelOption) => {
    setLibrary((l) => (l.some((o) => o.model.path === option.model.path) ? l : [...l, option]));
    update(blockId, { model: option.model, unitFt: option.unitFt });
  };
  const select = (blockId: string, key: string) => {
    const option = options.find((o) => `${o.model.area}/${o.model.path}` === key);
    if (key === SKIP) {
      update(blockId, { model: null });
    } else if (key === OTHER_FILE) {
      setFileTarget(blockId);
      input.current?.click();
    } else if (key.startsWith(FOLDER_PREFIX)) {
      importFolderModel(repository, key.slice(FOLDER_PREFIX.length)).then((o) => adoptModel(blockId, o), reportError);
    } else if (option) {
      update(blockId, { model: option.model, unitFt: option.unitFt });
    }
  };
  const pickFolder = async () => {
    const folder = await open({ directory: true, title: 'Folder with glTF models' });
    if (folder !== null) {
      onChange({ ...choices, modelFolder: folder });
    }
  };

  return (
    <div className="col">
      <p className="muted">
        {project.objects.length} objects of {kinds.length} kinds. Dungeon Alchemist's own models stay in Dungeon
        Alchemist; pick a stand-in per kind. Choices are kept for later imports.
      </p>
      <div className="row">
        {isTauri() && <Button icon="folder" label="Model folder…" onClick={() => pickFolder().catch(reportError)} />}
        {choices.modelFolder !== null && <span className="muted portrait-folder">{choices.modelFolder}</span>}
      </div>
      <table className="dam-objects">
        <thead>
          <tr>
            <th>Name</th>
            <th>Count</th>
            <th>Model</th>
            <th title="Feet per model unit: 5 for Dungeon Alchemist models, 3.28 for models in meters">ft/unit</th>
            <th title="Added turn, degrees clockwise">Turn</th>
          </tr>
        </thead>
        <tbody>
          {kinds.map(({ blockId, count }) => {
            const choice = choices.objects[blockId]!;
            return (
              <tr key={blockId}>
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
                    aria-label="Feet per unit"
                    onChange={(e) => update(blockId, { unitFt: Number(e.target.value) || choice.unitFt })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={15}
                    value={choice.rotationDeg}
                    aria-label="Turn"
                    onChange={(e) => update(blockId, { rotationDeg: Number(e.target.value) })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
            importModelFiles(repository, files).then((o) => adoptModel(fileTarget, o), reportError);
          }
        }}
      />
    </div>
  );
}
