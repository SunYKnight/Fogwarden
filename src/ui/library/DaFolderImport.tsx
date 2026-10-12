import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { parseDamProject, type DamProject } from '@/core/import/damProject';
import type { DamObjectChoices } from '@/core/import/damObjects';
import { collectDaMaps, daFloorName, parseDaFloor, type DaFloor } from '@/core/import/dungeonAlchemist';
import { mapAssetRef } from '@/data/repository';
import { importFile, listFolder, readFileText } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField } from '../components/fields';
import { Button, Dialog } from '../kit';
import { damPropsFor, loadDamObjectChoices, saveDamObjectChoices } from './daObjects';
import { choicesForProject, DamObjectsPanel } from './DamObjectsPanel';
import { saveImportedMap } from './mapImport';

interface FloorPlan {
  name: string;
  imagePath: string;
  imageName: string;
  floor: DaFloor;
}

interface MapPlan {
  floors: FloorPlan[];
  project: DamProject | null;
}

export interface FolderPlan {
  folder: string;
  maps: MapPlan[];
}

/** Reads every floor JSON and project file up front, so a broken file fails before anything is saved. */
async function planFolder(folder: string): Promise<FolderPlan> {
  const names = (await listFolder(folder)).filter((e) => !e.isDir).map((e) => e.name);
  const groups = collectDaMaps(names);
  if (groups.length === 0) {
    throw new Error(`No Dungeon Alchemist Foundry export (<map>.json with its picture) in ${folder}`);
  }
  const maps = await Promise.all(
    groups.map(async (files) => ({
      project: files.project ? parseDamProject(await readFileText(`${folder}/${files.project}`), files.project) : null,
      floors: await Promise.all(
        files.floors.map(async (f) => ({
          name: daFloorName(files, f),
          imagePath: `${folder}/${f.image}`,
          imageName: f.image,
          floor: parseDaFloor(await readFileText(`${folder}/${f.json}`), f.json),
        })),
      ),
    })),
  );
  return { folder, maps };
}

/** Picks a Dungeon Alchemist Foundry export folder and returns its plan, or null when cancelled. */
export async function pickDaFolder(): Promise<FolderPlan | null> {
  const folder = await open({ directory: true, title: 'Dungeon Alchemist Foundry export folder' });
  return folder === null ? null : planFolder(folder);
}

function floorSummary(floor: DaFloor): string {
  const { walls, openings, lights } = floor.content;
  return `${walls.length} walls, ${openings.length} doors, ${lights.length} lights`;
}

/**
 * Creates one map per floor of every export in the folder. A project file with the export's name
 * adds terrain and objects to the lowest floor; upper floors stand on their own.
 */
export function DaFolderImportDialog({ plan, onClose }: { plan: FolderPlan; onClose: () => void }) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [useProjects, setUseProjects] = useState(true);
  const [choices, setChoices] = useState<DamObjectChoices | null>(null);
  const [busy, setBusy] = useState(false);
  const projects = plan.maps.flatMap((m) => (m.project ? [m.project] : []));
  const withObjects = projects.filter((p) => p.objects.length > 0);

  const count = plan.maps.reduce((n, m) => n + m.floors.length, 0);

  useEffect(() => {
    const projectsWithObjects = plan.maps.flatMap((m) => (m.project?.objects.length ? [m.project] : []));
    if (projectsWithObjects.length > 0) {
      loadDamObjectChoices(repository)
        .then((kept) => setChoices(projectsWithObjects.reduce((all, p) => choicesForProject(p, all), kept)))
        .catch(reportError);
    }
  }, [plan, repository, reportError]);

  const run = async () => {
    setBusy(true);
    try {
      if (useProjects && choices) {
        await saveDamObjectChoices(repository, choices);
      }
      for (const map of plan.maps) {
        const project = useProjects ? map.project : null;
        for (const [i, f] of map.floors.entries()) {
          const ground = i === 0 ? project : null;
          await saveImportedMap(repository, {
            name: f.name,
            image: f.floor.image,
            calibration: f.floor.calibration,
            content: f.floor.content,
            project: ground,
            props: ground && choices ? damPropsFor(repository, ground, choices) : undefined,
            writeImage: async (mapId) => {
              const ref = mapAssetRef(mapId, f.imageName.replace(/[^\w.\- ]+/g, '_'));
              await importFile(f.imagePath, ref.path);
              return ref;
            },
          });
        }
      }
      await useLibraryStore.getState().refresh('map');
      useAppStore.getState().notify(`${count} maps imported from ${plan.folder}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Import Dungeon Alchemist folder"
      onClose={onClose}
      width={withObjects.length > 0 && useProjects ? 1000 : 640}
      footer={
        <>
          <Button label="Cancel" onClick={onClose} />
          <div className="spacer" />
          <Button
            icon="check"
            label={busy ? 'Importing…' : `Import ${count} ${count === 1 ? 'map' : 'maps'}`}
            variant="primary"
            disabled={busy}
            onClick={() => run().catch(reportError)}
          />
        </>
      }
    >
      <div className="col">
        <p className="muted portrait-folder">{plan.folder}</p>
        <ul className="portrait-list" aria-label="Floors">
          {plan.maps.flatMap((m) =>
            m.floors.map((f) => (
              <li key={f.imagePath}>
                <span className="row-name">{f.name}</span>
                <span className="muted">
                  {f.imageName} · {floorSummary(f.floor)}
                </span>
              </li>
            )),
          )}
        </ul>
        {projects.length > 0 && (
          <CheckboxField
            label={`Terrain and objects from ${projects.map((p) => p.fileName).join(', ')} (lowest floor)`}
            value={useProjects}
            onChange={setUseProjects}
          />
        )}
        {useProjects &&
          choices &&
          withObjects.map((p) => (
            <DamObjectsPanel key={p.fileName} project={p} choices={choices} onChange={setChoices} />
          ))}
      </div>
    </Dialog>
  );
}
